-- Devnet SOL drip from the site's faucet key: one row per top-up, used to
-- rate-limit per wallet and cap the daily total.
create table if not exists faucet_claims (
  id          bigserial primary key,
  wallet      text not null,
  lamports    bigint not null,
  claimed_at  timestamptz not null default now()
);
create index if not exists faucet_claims_wallet_idx on faucet_claims (wallet, claimed_at desc);
create index if not exists faucet_claims_time_idx on faucet_claims (claimed_at desc);
