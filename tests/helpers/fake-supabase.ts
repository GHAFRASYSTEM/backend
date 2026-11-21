// In-memory stand-in for the service-role Supabase client.
//
// Every `supabase.from(table)` chain is recorded (method + args) so tests can
// assert which filters a service applied. When a chain is awaited it resolves
// with the next result queued for that table, or a sensible default.

export const ADMIN_ID  = '0b7c6d2e-1f3a-4c5b-8d9e-1a2b3c4d5e6f';
export const MEMBER_ID = '9f8e7d6c-5b4a-4938-a7b6-c5d4e3f2a1b0';

export const TOKENS = {
  admin:  'admin-token',
  member: 'member-token',
} as const;

const USERS: Record<string, { id: string; role: string }> = {
  [TOKENS.admin]:  { id: ADMIN_ID,  role: 'admin'  },
  [TOKENS.member]: { id: MEMBER_ID, role: 'member' },
};

export interface QueryResult {
  data?:  unknown;
  error?: unknown;
  count?: number | null;
}

export interface RecordedCall  { method: string; args: unknown[] }
export interface RecordedQuery { table: string; calls: RecordedCall[] }

const queues   = new Map<string, QueryResult[]>();
const recorded: RecordedQuery[] = [];
const storageCalls: { bucket: string; method: string; args: unknown[] }[] = [];

function defaultResult(query: RecordedQuery): QueryResult {
  // requireRole looks up profiles.role by id.
  if (query.table === 'profiles') {
    const id   = query.calls.find(c => c.method === 'eq' && c.args[0] === 'id')?.args[1];
    const user = Object.values(USERS).find(u => u.id === id);
    return user ? { data: { role: user.role } } : { error: { message: 'not found' } };
  }
  return {};
}

function from(table: string) {
  const query: RecordedQuery = { table, calls: [] };
  recorded.push(query);

  const builder: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        const queued = queues.get(table)?.shift();
        const result = { data: null, error: null, count: null, ...(queued ?? defaultResult(query)) };
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject);
      }
      return (...args: unknown[]) => {
        query.calls.push({ method: String(prop), args });
        return builder;
      };
    },
  });
  return builder;
}

export const fakeSupabase = {
  from,
  auth: {
    async getUser(token: string) {
      const user = USERS[token];
      return user
        ? { data: { user: { id: user.id, role: 'authenticated' } }, error: null }
        : { data: { user: null }, error: { message: 'invalid token' } };
    },
  },
  storage: {
    from(bucket: string) {
      const call = (method: string, args: unknown[]) => {
        storageCalls.push({ bucket, method, args });
      };
      return {
        async upload(...args: unknown[]) {
          call('upload', args);
          return queues.get('storage.upload')?.shift() ?? { data: { path: args[0] }, error: null };
        },
        async remove(...args: unknown[]) {
          call('remove', args);
          return queues.get('storage.remove')?.shift() ?? { data: [], error: null };
        },
        getPublicUrl(path: string) {
          call('getPublicUrl', [path]);
          return {
            data: { publicUrl: `http://localhost:54321/storage/v1/object/public/${bucket}/${path}` },
          };
        },
      };
    },
  },
};

export const db = {
  reset() {
    queues.clear();
    recorded.length = 0;
    storageCalls.length = 0;
  },

  storage() {
    return storageCalls;
  },

  queue(table: string, ...results: QueryResult[]) {
    queues.set(table, [...(queues.get(table) ?? []), ...results]);
  },

  queries(table: string): RecordedQuery[] {
    return recorded.filter(q => q.table === table);
  },

  calls(query: RecordedQuery, method: string): unknown[][] {
    return query.calls.filter(c => c.method === method).map(c => c.args);
  },
};

export const auth = (who: keyof typeof TOKENS) => ({ Authorization: `Bearer ${TOKENS[who]}` });
