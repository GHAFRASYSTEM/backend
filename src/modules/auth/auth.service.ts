import { supabase }            from '../../config/supabase';
import { mailService }         from '../mail/mail.service';
import { notificationService } from '../notifications/notifications.service';
import { Errors }              from '../../shared/errors';
import type {
  GoogleCallbackInput,
  AdminGoogleSignInInput,
  CompleteProfileInput,
  AppleSignInInput,
  EmailSignInInput
} from './auth.schema';

// ── Region assignment ─────────────────────────────────────────────────────────
const REGIONS = ['Accra', 'Kumasi', 'Tamale', 'Sunyani'] as const;
type Region = typeof REGIONS[number];

async function assignRegion(): Promise<Region> {
  const counts = await Promise.all(
    REGIONS.map(async region => {
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('region', region);
      return { region, count: count ?? 0 };
    })
  );
  counts.sort((a, b) => a.count - b.count);
  return counts[0].region as Region;
}

export const authService = {

  // ── 1. Member Google sign-in ──────────────────────────────────────────────
  async handleGoogleSignIn(input: GoogleCallbackInput) {
    const { access_token, device_token, platform } = input;

    const { data: { user }, error } = await supabase.auth.getUser(access_token);
    if (error || !user) throw Errors.unauthorized();

    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    let profile     = existingProfile;
    let isNewMember = false;

    if (!existingProfile) {
      isNewMember = true;

      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id:           user.id,
          email:        user.email!,
          name:         user.user_metadata?.full_name  ?? '',
          photo_url:    user.user_metadata?.avatar_url ?? '',
          role:         'member',
          is_complete:  false,
          member_since: new Date().toISOString().split('T')[0],
        })
        .select()
        .single();

      if (insertError) throw insertError;
      profile = newProfile;
    }

    if (profile?.role === 'admin') throw Errors.forbidden();

    if (device_token && platform) {
      await authService.saveFcmToken(user.id, device_token, platform);
    }

    return {
      user,
      profile,
      isNewMember,
      isProfileComplete: profile?.is_complete ?? false,
    };
  },

  // ── 2. Admin Google sign-in ───────────────────────────────────────────────
  async handleAdminSignIn(input: AdminGoogleSignInInput) {
    const { access_token } = input;

    const { data: { user }, error } = await supabase.auth.getUser(access_token);
    if (error || !user) throw Errors.unauthorized();

    const { data: allowed } = await supabase
      .from('admin_allowlist')
      .select('email')
      .eq('email', user.email!)
      .single();

    if (!allowed) throw Errors.forbidden();

    const { data: profile, error: upsertError } = await supabase
      .from('profiles')
      .upsert({
        id:          user.id,
        email:       user.email!,
        name:        user.user_metadata?.full_name  ?? '',
        photo_url:   user.user_metadata?.avatar_url ?? '',
        role:        'admin',
        is_complete: true,
      })
      .select()
      .single();

    if (upsertError) throw upsertError;

    await supabase.from('admin_audit_log').insert({
      admin_id: user.id,
      action:   'sign_in',
      detail:   'Admin signed in via Google',
    });

    return { user, profile, role: 'admin' };
  },

  // ── 3. Complete profile ───────────────────────────────────────────────────
  async completeProfile(userId: string, input: CompleteProfileInput) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, email, name, is_complete')
      .eq('id', userId)
      .single();

    if (!existing)            throw Errors.notFound('Profile');
    if (existing.is_complete) throw Errors.conflict('Profile already complete');

    const region = await assignRegion();

    const { data: profile, error } = await supabase
      .from('profiles')
      .update({
        name:         input.name,
        gender:       input.gender,
        ghana_phone:  input.ghana_phone,
        french_phone: input.french_phone ?? null,
        city:         input.city,
        occupation:   input.occupation,
        photo_url:    input.photo_url    ?? null,
        region,
        is_complete:  true,
        updated_at:   new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    await Promise.allSettled([
      mailService.sendWelcome({ name: profile.name, email: profile.email }),
      notificationService.sendToUser(userId, {
        title: '🎉 Welcome to GHAFRA!',
        body:  `Hi ${profile.name}, your profile is complete. Welcome to the ${region} chapter!`,
      }),
    ]);

    return profile;
  },

  // ── 4. Refresh session ────────────────────────────────────────────────────
  async refreshSession(refreshToken: string) {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.session) throw Errors.unauthorized();
    return data.session;
  },

  // ── 5. Sign out ───────────────────────────────────────────────────────────
  async signOut(userId: string, fcmToken?: string) {
    if (fcmToken) {
      await supabase
        .from('fcm_tokens')
        .delete()
        .eq('user_id', userId)
        .eq('token', fcmToken);
    }
    await supabase.auth.admin.signOut(userId);
  },

  // ── 6. Get profile ────────────────────────────────────────────────────────
  async getProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error || !data) throw Errors.notFound('Profile');
    return data;
  },

  // ── 7. FCM token ──────────────────────────────────────────────────────────
  async saveFcmToken(userId: string, token: string, platform: 'ios' | 'android') {
    await supabase
      .from('fcm_tokens')
      .upsert(
        { user_id: userId, token, platform, updated_at: new Date().toISOString() },
        { onConflict: 'token' }
      );
  },

  // ── 8. Apple sign-in ──────────────────────────────────────────────────────
  async handleAppleSignIn(input: AppleSignInInput) {
    const { identity_token, device_token, platform } = input;

    const { data: { user, session }, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token:    identity_token,
    });

    if (error || !user || !session) throw Errors.unauthorized();

    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    let profile     = existingProfile;
    let isNewMember = false;

    if (!existingProfile) {
      isNewMember = true;

      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id:           user.id,
          email:        user.email ?? user.user_metadata?.email ?? '',
          name:         user.user_metadata?.full_name ?? '',
          photo_url:    null,
          role:         'member',
          is_complete:  false,
          member_since: new Date().toISOString().split('T')[0],
        })
        .select()
        .single();

      if (insertError) throw insertError;
      profile = newProfile;
    }

    if (profile?.role === 'admin') throw Errors.forbidden();

    if (device_token && platform) {
      await authService.saveFcmToken(user.id, device_token, platform);
    }

    return {
      user,
      session,
      profile,
      isNewMember,
      isProfileComplete: profile?.is_complete ?? false,
    };
  },

  // ── 9. Email sign-in / auto sign-up ──────────────────────────────────────
async handleEmailSignIn(input: EmailSignInInput) {
  const { email, password, device_token, platform } = input;

  // ── 1. Try sign-in first ──────────────────────────────────────────────
  const { data: signInData, error: signInError } =
    await supabase.auth.signInWithPassword({ email, password });

  if (!signInError && signInData.user && signInData.session) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', signInData.user.id)
      .single();

    if (!profile) throw Errors.notFound('Profile');
    if (profile.role === 'admin') throw Errors.forbidden();

    if (device_token && platform) {
      await authService.saveFcmToken(signInData.user.id, device_token, platform);
    }

    return {
      user:              signInData.user,
      session:           signInData.session,
      profile,
      isNewMember:       false,
      isProfileComplete: profile.is_complete ?? false,
    };
  }

  // ── 2. Sign-in failed — look up the auth user directly by email ───────
  // This catches ALL cases: wrong password, OAuth-only account, etc.
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const existingAuthUser = users.find((u: any) => u.email === email);

  if (existingAuthUser) {
    const provider = existingAuthUser.app_metadata?.provider;

    // OAuth account trying to use email/password
    if (provider && provider !== 'email') {
      const name = provider.charAt(0).toUpperCase() + provider.slice(1);
      throw Errors.badRequest(
        `This account was created with ${name} sign-in. Please use the ${name} button instead.`
      );
    }

    // Email account but wrong password
    throw Errors.unauthorized();
  }

  // ── 3. Genuinely new user — create account ────────────────────────────
  const { data: signUpData, error: signUpError } =
    await supabase.auth.signUp({ email, password });

  if (signUpError || !signUpData.user) {
    throw Errors.badRequest(signUpError?.message ?? 'Sign-up failed');
  }

  const user = signUpData.user;

  const { data: newProfile, error: insertError } = await supabase
    .from('profiles')
    .insert({
      id:           user.id,
      email:        user.email!,
      name:         '',
      photo_url:    null,
      role:         'member',
      is_complete:  false,
      member_since: new Date().toISOString().split('T')[0],
    })
    .select()
    .single();

  if (insertError) throw insertError;

  if (device_token && platform) {
    await authService.saveFcmToken(user.id, device_token, platform);
  }

  return {
    user,
    session:           signUpData.session ?? null,
    profile:           newProfile,
    isNewMember:       true,
    isProfileComplete: false,
  };
},

  // ── 10. Delete FCM token ──────────────────────────────────────────────────
  async deleteFcmToken(userId: string, token: string) {
    await supabase
      .from('fcm_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('token', token);
  },
};