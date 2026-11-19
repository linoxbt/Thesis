-- Transactions the indexer could not process. The cursor moves past them so
-- one bad transaction can't stall indexing; each pass retries them.
create table if not exists indexer_failures (
  signature   text not null,
  cursor_key  text not null,
  error       text not null,
  attempts    int not null default 1,
  first_seen  timestamptz not null default now(),
  last_tried  timestamptz not null default now(),
  resolved    boolean not null default false,
  primary key (signature, cursor_key)
);
create index if not exists indexer_failures_open_idx on indexer_failures (resolved, attempts);

-- Volume windows and the activity feed read trades by time.
create index if not exists trades_ts_idx on trades (ts desc);
