-- Abuse guards for the web API.

-- Per-IP faucet limit (a hash, never the address itself).
alter table faucet_claims add column if not exists ip_hash text;
create index if not exists faucet_claims_ip_idx on faucet_claims (ip_hash, claimed_at desc);

-- Wallet signatures already used for a state change (replay protection).
create table if not exists used_signatures (
  sig_hash  text primary key,
  purpose   text not null,
  used_at   timestamptz not null default now()
);

-- Fixed-window request counters (rate limits shared by every serverless instance).
create table if not exists rate_hits (
  key        text not null,
  window_ts  bigint not null,
  hits       int not null default 1,
  primary key (key, window_ts)
);
