import type { CreddyOfficialEvidence } from './pipeline-types.js';

type OfficialSourceType = CreddyOfficialEvidence['sourceType'];

type OfficialDomain = {
  owner: string;
  sourceTypes: OfficialSourceType[];
};

/**
 * Deliberately bounded allowlist for evidence that may be called "official".
 * Unknown first-party sites may still be recorded as attempted URLs, but they
 * must remain inconclusive until this registry is reviewed and extended.
 */
const OFFICIAL_DOMAINS: Record<string, OfficialDomain> = {
  'americanexpress.com': { owner: 'American Express', sourceTypes: ['issuer'] },
  'chase.com': { owner: 'Chase', sourceTypes: ['issuer'] },
  'capitalone.com': { owner: 'Capital One', sourceTypes: ['issuer'] },
  'citi.com': { owner: 'Citi', sourceTypes: ['issuer'] },
  'wellsfargo.com': { owner: 'Wells Fargo', sourceTypes: ['issuer'] },
  'bankofamerica.com': { owner: 'Bank of America', sourceTypes: ['issuer'] },
  'barclaycardus.com': { owner: 'Barclays', sourceTypes: ['issuer'] },
  'usbank.com': { owner: 'U.S. Bank', sourceTypes: ['issuer'] },
  'discover.com': { owner: 'Discover', sourceTypes: ['issuer'] },
  'aa.com': { owner: 'American Airlines', sourceTypes: ['airline', 'loyalty_program'] },
  'delta.com': { owner: 'Delta Air Lines', sourceTypes: ['airline', 'loyalty_program'] },
  'united.com': { owner: 'United Airlines', sourceTypes: ['airline', 'loyalty_program'] },
  'southwest.com': { owner: 'Southwest Airlines', sourceTypes: ['airline', 'loyalty_program'] },
  'jetblue.com': { owner: 'JetBlue', sourceTypes: ['airline', 'loyalty_program'] },
  'alaskaair.com': { owner: 'Alaska Airlines', sourceTypes: ['airline', 'loyalty_program'] },
  'aircanada.com': { owner: 'Air Canada', sourceTypes: ['airline', 'loyalty_program'] },
  'emirates.com': { owner: 'Emirates', sourceTypes: ['airline', 'loyalty_program'] },
  'singaporeair.com': { owner: 'Singapore Airlines', sourceTypes: ['airline', 'loyalty_program'] },
  'britishairways.com': { owner: 'British Airways', sourceTypes: ['airline', 'loyalty_program'] },
  'virginatlantic.com': { owner: 'Virgin Atlantic', sourceTypes: ['airline', 'loyalty_program'] },
  'flyingblue.com': { owner: 'Flying Blue', sourceTypes: ['loyalty_program'] },
  'marriott.com': { owner: 'Marriott', sourceTypes: ['hotel', 'loyalty_program'] },
  'hilton.com': { owner: 'Hilton', sourceTypes: ['hotel', 'loyalty_program'] },
  'hyatt.com': { owner: 'Hyatt', sourceTypes: ['hotel', 'loyalty_program'] },
  'ihg.com': { owner: 'IHG', sourceTypes: ['hotel', 'loyalty_program'] },
  'choicehotels.com': { owner: 'Choice Hotels', sourceTypes: ['hotel', 'loyalty_program'] },
  'wyndhamhotels.com': { owner: 'Wyndham Hotels', sourceTypes: ['hotel', 'loyalty_program'] },
  'all.accor.com': { owner: 'ALL - Accor Live Limitless', sourceTypes: ['hotel', 'loyalty_program'] },
  'dfwairport.com': { owner: 'Dallas Fort Worth International Airport', sourceTypes: ['airport'] },
  'flylax.com': { owner: 'Los Angeles World Airports', sourceTypes: ['airport'] },
  'portseattle.org': { owner: 'Port of Seattle', sourceTypes: ['airport', 'government'] },
  'flychicago.com': { owner: 'Chicago Department of Aviation', sourceTypes: ['airport', 'government'] },
  'panynj.gov': { owner: 'Port Authority of New York and New Jersey', sourceTypes: ['airport', 'government'] },
  'massport.com': { owner: 'Massachusetts Port Authority', sourceTypes: ['airport', 'government'] },
  'transportation.gov': { owner: 'U.S. Department of Transportation', sourceTypes: ['government'] },
  'faa.gov': { owner: 'Federal Aviation Administration', sourceTypes: ['government'] },
  'consumerfinance.gov': { owner: 'Consumer Financial Protection Bureau', sourceTypes: ['government'] },
};

function normalizedHost(url: URL): string {
  return url.hostname.replace(/^www\./, '').toLocaleLowerCase('en-US');
}

export function officialDomainFor(url: URL): OfficialDomain | undefined {
  const host = normalizedHost(url);
  return Object.entries(OFFICIAL_DOMAINS)
    .find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1];
}

export function assertRegisteredOfficialEvidence(evidence: CreddyOfficialEvidence): void {
  const url = new URL(evidence.url);
  const registered = officialDomainFor(url);
  if (!registered) {
    throw new Error(`Unknown official evidence host must remain an attempted URL only: ${normalizedHost(url)}`);
  }
  if (evidence.owner.trim() !== registered.owner || !registered.sourceTypes.includes(evidence.sourceType)) {
    throw new Error(`Official evidence owner or source type does not match the registry for ${normalizedHost(url)}`);
  }
}
