import type { SeedEntity } from "./types.js";

export const SEED_ENTITIES: SeedEntity[] = [
  // ─── Finance (3) ───
  {
    name: "JPMorgan Chase",
    industry: "finance",
    subIndustry: "retail-banking",
    entityType: "company",
    sourceUrls: ["https://www.chase.com/digital/resources/privacy-security/questions"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "Bank of America",
    industry: "finance",
    subIndustry: "retail-banking",
    entityType: "company",
    sourceUrls: ["https://www.bankofamerica.com/customer-service/"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "Wells Fargo",
    industry: "finance",
    subIndustry: "retail-banking",
    entityType: "company",
    sourceUrls: ["https://www.wellsfargo.com/help/"],
    tags: ["fortune-500", "cx"],
  },

  // ─── Insurance (3) ───
  {
    name: "UnitedHealth Group",
    industry: "insurance",
    subIndustry: "health-insurance",
    entityType: "company",
    sourceUrls: ["https://www.uhc.com/member-resources"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "Elevance Health",
    industry: "insurance",
    subIndustry: "health-insurance",
    entityType: "company",
    sourceUrls: ["https://www.anthem.com/member/"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "MetLife",
    industry: "insurance",
    subIndustry: "life-insurance",
    entityType: "company",
    sourceUrls: ["https://www.metlife.com/support/"],
    tags: ["fortune-500", "cx"],
  },

  // ─── Healthcare (3) ───
  {
    name: "CVS Health",
    industry: "healthcare",
    subIndustry: "pharmacy",
    entityType: "company",
    sourceUrls: ["https://www.cvs.com/help/"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "HCA Healthcare",
    industry: "healthcare",
    subIndustry: "hospital-systems",
    entityType: "company",
    sourceUrls: ["https://www.hcahealthcare.com/patients/"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "Humana",
    industry: "healthcare",
    subIndustry: "health-insurance",
    entityType: "company",
    sourceUrls: ["https://www.humana.com/help/"],
    tags: ["fortune-500", "cx"],
  },

  // ─── Telecom (3) ───
  {
    name: "AT&T",
    industry: "telecom",
    subIndustry: "wireless",
    entityType: "company",
    sourceUrls: ["https://www.att.com/support/"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "Verizon",
    industry: "telecom",
    subIndustry: "wireless",
    entityType: "company",
    sourceUrls: ["https://www.verizon.com/support/"],
    tags: ["fortune-500", "cx"],
  },
  {
    name: "T-Mobile",
    industry: "telecom",
    subIndustry: "wireless",
    entityType: "company",
    sourceUrls: ["https://www.t-mobile.com/support/"],
    tags: ["fortune-500", "cx"],
  },

  // ─── Education (3) ───
  {
    name: "University of California System",
    industry: "education",
    subIndustry: "higher-education",
    entityType: "company",
    sourceUrls: ["https://www.universityofcalifornia.edu/"],
    tags: ["public-university", "cx"],
  },
  {
    name: "Coursera",
    industry: "education",
    subIndustry: "online-learning",
    entityType: "company",
    sourceUrls: ["https://www.coursera.org/about/"],
    tags: ["edtech", "cx"],
  },
  {
    name: "Pearson",
    industry: "education",
    subIndustry: "publishing",
    entityType: "company",
    sourceUrls: ["https://www.pearson.com/en-us/support.html"],
    tags: ["fortune-500", "cx"],
  },

  // ─── Government - States (8) ───
  {
    name: "California",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://www.ca.gov/"],
    tags: ["government", "state", "west"],
  },
  {
    name: "Texas",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://www.texas.gov/"],
    tags: ["government", "state", "south"],
  },
  {
    name: "New York",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://www.ny.gov/"],
    tags: ["government", "state", "northeast"],
  },
  {
    name: "Florida",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://www.myflorida.com/"],
    tags: ["government", "state", "south"],
  },
  {
    name: "Illinois",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://www.illinois.gov/"],
    tags: ["government", "state", "midwest"],
  },
  {
    name: "Ohio",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://ohio.gov/"],
    tags: ["government", "state", "midwest"],
  },
  {
    name: "Georgia",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://georgia.gov/"],
    tags: ["government", "state", "south"],
  },
  {
    name: "Washington",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: ["https://wa.gov/"],
    tags: ["government", "state", "west"],
  },

  // ─── Government - Counties (5) ───
  {
    name: "Los Angeles County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: ["https://lacounty.gov/"],
    tags: ["government", "county", "west"],
  },
  {
    name: "Cook County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: ["https://www.cookcountyil.gov/"],
    tags: ["government", "county", "midwest"],
  },
  {
    name: "Harris County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: ["https://www.harriscountytx.gov/"],
    tags: ["government", "county", "south"],
  },
  {
    name: "Maricopa County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: ["https://www.maricopa.gov/"],
    tags: ["government", "county", "west"],
  },
  {
    name: "King County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: ["https://kingcounty.gov/"],
    tags: ["government", "county", "west"],
  },
];

export function getSeedIndustries(): string[] {
  return [...new Set(SEED_ENTITIES.map((e) => e.industry))];
}

export function getSeedEntitiesByIndustry(industry: string): SeedEntity[] {
  return SEED_ENTITIES.filter((e) => e.industry === industry);
}
