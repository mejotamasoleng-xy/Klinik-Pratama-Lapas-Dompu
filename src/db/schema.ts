import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// Mandatory users table per cloudsql-setup skill
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const rateLimitState = pgTable('rate_limit_state', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  windowStart: bigint('window_start', { mode: 'number' }).notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
