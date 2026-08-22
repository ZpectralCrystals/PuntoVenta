import { createClient } from '@supabase/supabase-js';
import { hashPassword } from '../server/cloud-store.mjs';
import { INITIAL_STATE } from '../src/lib/initial-state.js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Faltan variables Supabase');

const state = structuredClone(INITIAL_STATE);
state.sessions = [];
state.sales = [];
state.events = [];
state.users = state.users.map((user) => {
  const next = { ...user, passwordHash: user.passwordHash || hashPassword(user.password) };
  delete next.password;
  return next;
});

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error } = await db.from('app_state').upsert({
  id: 1,
  state,
  revision: 1,
  updated_at: new Date().toISOString(),
});
if (error) throw error;
console.log(JSON.stringify({ ok: true, revision: 1, sales: 0, sessions: 0, events: 0 }));
