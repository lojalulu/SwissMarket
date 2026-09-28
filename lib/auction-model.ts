// lib/auction-model.ts — modelo de leilões partilhado por todos os produtos (recalculado no máx. a cada 5 min).
import { activeProducts } from '../config/products';
import { buildAuctionModel, type AuctionModel } from './stats';
import { effectiveRecords } from './store';

let cache: { at: number; model: AuctionModel } | null = null;

export function getAuctionModel(now = new Date()): AuctionModel {
  if (cache && now.getTime() - cache.at < 5 * 60e3) return cache.model;
  const model = buildAuctionModel(activeProducts().map((p) => effectiveRecords(p.id)));
  cache = { at: now.getTime(), model };
  return model;
}
