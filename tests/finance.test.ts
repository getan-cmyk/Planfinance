import { describe, expect, it } from 'vitest';
import { availableMoney, emergencyCoverage, fuelMetrics, portfolioAllocation, savingsRate } from '../src/lib/finance';
describe('finance calculations',()=>{
  it('excludes reserved money from available balance',()=>expect(availableMoney(3000000,112500,0,0)).toBe(2887500));
  it('calculates savings rate without floating errors',()=>expect(savingsRate(1650000,1417500)).toBe(14.09));
  it('returns null coverage when essentials are absent',()=>expect(emergencyCoverage(3000000,0)).toBeNull());
  it('calculates allocation',()=>expect(portfolioAllocation(150000,1000000)).toBe(15));
  it('does not infer fuel economy from incomplete readings',()=>expect(fuelMetrics(1000,null,30_000_000,150000)).toBeNull());
  it('calculates fuel efficiency from consecutive readings',()=>expect(fuelMetrics(1200,1000,20_000_000,80000)).toEqual({kmPerLiter:10,costPerKmSatang:400}));
});
