import { fcm }      from '../../config/firebase';
import { supabase } from '../../config/supabase';

export const notificationService = {

  async sendToUser(
    userId:       string,
    notification: { title: string; body: string },
    data?:        Record<string, string>,
  ) {
    const { data: tokens } = await supabase
      .from('fcm_tokens')
      .select('token')
      .eq('user_id', userId);

    if (!tokens?.length) return;

    const messages = tokens.map(({ token }) => ({
      token,
      notification,
      data,
      apns: { payload: { aps: { sound: 'default' } } },
    }));

    const response = await fcm.sendEach(messages);
    console.log(`FCM: ${response.successCount} sent, ${response.failureCount} failed`);
  },

  async broadcast(
    notification: { title: string; body: string },
    data?:        Record<string, string>,
  ) {
    const { data: tokens } = await supabase
      .from('fcm_tokens')
      .select('token');

    if (!tokens?.length) return;

    // FCM multicast max is 500 per request
    const chunks = chunkArray(tokens.map(t => t.token), 500);

    for (const chunk of chunks) {
      await fcm.sendEachForMulticast({ tokens: chunk, notification, data });
    }
  },
};

function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from(
    { length: Math.ceil(arr.length / size) },
    (_, i) => arr.slice(i * size, i * size + size),
  );
}