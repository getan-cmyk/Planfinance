export const toSatang = (baht: number) => Math.round(baht * 100);
export const fromSatang = (satang: number) => satang / 100;
export const savingsRate = (income: number, expenses: number) => income <= 0 ? 0 : Math.round(((income - expenses) / income) * 10000) / 100;
export const availableMoney = (liquid: number, reserved: number, obligations: number, unpaid: number) => liquid - reserved - obligations - unpaid;
export const emergencyCoverage = (savings: number, essentials: number) => essentials <= 0 ? null : Math.round((savings / essentials) * 100) / 100;
export const portfolioAllocation = (value: number, total: number) => total <= 0 ? 0 : Math.round((value / total) * 10000) / 100;
export const fuelMetrics = (currentKm: number, previousKm: number | null, litersMicros: number, totalSatang: number) => {
  if (previousKm === null || currentKm <= previousKm || litersMicros <= 0) return null;
  const km = currentKm - previousKm; const liters = litersMicros / 1_000_000;
  return { kmPerLiter: Math.round((km / liters) * 100) / 100, costPerKmSatang: Math.round(totalSatang / km) };
};
