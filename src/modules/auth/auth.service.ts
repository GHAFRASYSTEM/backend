import { supabase }            from '../../config/supabase';
import { mailService }         from '../mail/mail.service';
import { notificationService } from '../notifications/notifications.service';
import { Errors }              from '../../shared/errors';
import type {
  GoogleCallbackInput,
  AdminGoogleSignInInput,
  CompleteProfileInput,
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

    // Reject if this Google account belongs to an admin —
    // admins must use the /admin/google endpoint
    if (profile?.role === 'admin') {
      throw Errors.forbidden();
    }

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
  // Admins must already exist in the profiles table with role = 'admin'.
  // They cannot self-register. No profile completion, no FCM.
 async handleAdminSignIn(input: AdminGoogleSignInInput) {
  const { access_token } = input;

  const { data: { user }, error } =
    await supabase.auth.getUser(access_token);

  if (error || !user) throw Errors.unauthorized();

  // ✅ Check allowlist FIRST
  const { data: allowed } = await supabase
    .from('admin_allowlist')
    .select('email')
    .eq('email', user.email!)
    .single();

  if (!allowed) {
    throw Errors.forbidden();
  }

  // ✅ Upsert admin profile
  const { data: profile, error: upsertError } =
    await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email!,
        name: user.user_metadata?.full_name ?? '',
        photo_url: user.user_metadata?.avatar_url ?? '',
        role: 'admin',
        is_complete: true,
      })
      .select()
      .single();

  if (upsertError) throw upsertError;

  // audit log
  await supabase.from('admin_audit_log').insert({
    admin_id: user.id,
    action: 'sign_in',
    detail: 'Admin signed in via Google',
  });

  return {
    user,
    profile,
    role: 'admin',
  };
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

  async deleteFcmToken(userId: string, token: string) {
    await supabase
      .from('fcm_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('token', token);
  },
};