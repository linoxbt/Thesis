"use client";

import { PublicKey } from "@solana/web3.js";
import { useMemo } from "react";
import { usePoll } from "./api";

export interface PublicConfig {
  cluster: string;
  usdcMint: string;
  creatorShareBps: number;
  graceSecs: number;
  maxConfBps: number;
  minSeedUsdc: number;
  maxSeedUsdc: number;
  maxCoverUsdc: number;
  solVolBps: number;
  volUpdatedTs: number;
  maxSpotAgeSecs: number;
  minStrikeDistanceBps: number;
  maxStrikeDistanceBps: number;
  minOpenBps: number;
  maxOpenBps: number;
  paused: boolean;
}

export function useConfig() {
  const { data, error } = usePoll<PublicConfig>("/api/config", 60_000);
  const usdcMint = useMemo(() => (data ? new PublicKey(data.usdcMint) : null), [data]);
  return { config: data, usdcMint, error };
}

export interface Spot {
  price: string;
  conf: string;
  expo: number;
  publishTime: number;
}

export function useSpot() {
  return usePoll<Spot>("/api/spot", 15_000);
}
