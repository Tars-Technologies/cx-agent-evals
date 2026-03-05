import type { SeedEntity } from "./types.js";

export const SEED_ENTITIES: SeedEntity[] = [
  // ── Finance (3) ──────────────────────────────────────────────
  {
    name: "JPMorgan Chase",
    industry: "finance",
    subIndustry: "retail-banking",
    entityType: "company",
    sourceUrls: [
      "https://www.chase.com/digital/resources/privacy-security/security/report-fraud",
      "https://www.chase.com/personal/customer-service",
    ],
    tags: ["fortune-500", "cx", "support", "banking"],
  },
  {
    name: "Bank of America",
    industry: "finance",
    subIndustry: "retail-banking",
    entityType: "company",
    sourceUrls: [
      "https://www.bankofamerica.com/customer-service/contact-us/",
      "https://www.bankofamerica.com/security-center/faq/",
    ],
    tags: ["fortune-500", "cx", "support", "banking"],
  },
  {
    name: "Wells Fargo",
    industry: "finance",
    subIndustry: "retail-banking",
    entityType: "company",
    sourceUrls: [
      "https://www.wellsfargo.com/help/",
      "https://www.wellsfargo.com/privacy-security/fraud/report/",
    ],
    tags: ["fortune-500", "cx", "support", "banking"],
  },

  // ── Insurance (3) ───────────────────────────────────────────
  {
    name: "UnitedHealth Group",
    industry: "insurance",
    subIndustry: "health-insurance",
    entityType: "company",
    sourceUrls: [
      "https://www.uhc.com/member-resources/contact-us",
      "https://www.uhc.com/member-resources/member-faq",
    ],
    tags: ["fortune-500", "cx", "support", "health-insurance"],
  },
  {
    name: "Elevance Health",
    industry: "insurance",
    subIndustry: "health-insurance",
    entityType: "company",
    sourceUrls: [
      "https://www.anthem.com/contact-us/",
      "https://www.anthem.com/member/faq",
    ],
    tags: ["fortune-500", "cx", "support", "health-insurance"],
  },
  {
    name: "MetLife",
    industry: "insurance",
    subIndustry: "life-insurance",
    entityType: "company",
    sourceUrls: [
      "https://www.metlife.com/support/",
      "https://www.metlife.com/support/faq/",
    ],
    tags: ["fortune-500", "cx", "support", "life-insurance"],
  },

  // ── Healthcare (3) ──────────────────────────────────────────
  {
    name: "CVS Health",
    industry: "healthcare",
    subIndustry: "pharmacy",
    entityType: "company",
    sourceUrls: [
      "https://www.cvs.com/help/help-index.jsp",
      "https://www.cvs.com/help/email-customer-relations.jsp",
    ],
    tags: ["fortune-500", "cx", "support", "pharmacy"],
  },
  {
    name: "HCA Healthcare",
    industry: "healthcare",
    subIndustry: "hospital-systems",
    entityType: "company",
    sourceUrls: [
      "https://hcahealthcare.com/patients/",
      "https://hcahealthcare.com/about/faq.dot",
    ],
    tags: ["fortune-500", "cx", "support", "hospital"],
  },
  {
    name: "Humana",
    industry: "healthcare",
    subIndustry: "managed-care",
    entityType: "company",
    sourceUrls: [
      "https://www.humana.com/help/contact-us",
      "https://www.humana.com/help",
    ],
    tags: ["fortune-500", "cx", "support", "managed-care"],
  },

  // ── Telecom (3) ─────────────────────────────────────────────
  {
    name: "AT&T",
    industry: "telecom",
    subIndustry: "wireless",
    entityType: "company",
    sourceUrls: [
      "https://www.att.com/support/",
      "https://www.att.com/support/contact-us/",
    ],
    tags: ["fortune-500", "cx", "support", "wireless"],
  },
  {
    name: "Verizon",
    industry: "telecom",
    subIndustry: "wireless",
    entityType: "company",
    sourceUrls: [
      "https://www.verizon.com/support/",
      "https://www.verizon.com/support/contact-us/",
    ],
    tags: ["fortune-500", "cx", "support", "wireless"],
  },
  {
    name: "T-Mobile",
    industry: "telecom",
    subIndustry: "wireless",
    entityType: "company",
    sourceUrls: [
      "https://www.t-mobile.com/support",
      "https://www.t-mobile.com/contact-us",
    ],
    tags: ["fortune-500", "cx", "support", "wireless"],
  },

  // ── Education (3) ───────────────────────────────────────────
  {
    name: "University of California System",
    industry: "education",
    subIndustry: "public-university",
    entityType: "company",
    sourceUrls: [
      "https://www.universityofcalifornia.edu/about-us/contact-us",
      "https://admission.universityofcalifornia.edu/how-to-apply/applying-as-a-freshman/",
    ],
    tags: ["cx", "support", "public-university", "higher-education"],
  },
  {
    name: "Coursera",
    industry: "education",
    subIndustry: "online-education",
    entityType: "company",
    sourceUrls: [
      "https://www.coursera.support/s/",
      "https://www.coursera.org/about/contact",
    ],
    tags: ["cx", "support", "online-education", "edtech"],
  },
  {
    name: "Pearson",
    industry: "education",
    subIndustry: "educational-publishing",
    entityType: "company",
    sourceUrls: [
      "https://www.pearson.com/en-us/support.html",
      "https://www.pearson.com/en-us/contact-us.html",
    ],
    tags: ["cx", "support", "educational-publishing", "edtech"],
  },

  // ── Government - States (8) ─────────────────────────────────
  {
    name: "California",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: [
      "https://www.ca.gov/contact/",
      "https://www.dmv.ca.gov/portal/customer-service/",
    ],
    tags: ["government", "state", "cx", "support"],
  },
  {
    name: "Texas",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: [
      "https://www.texas.gov/contact/",
      "https://www.txdmv.gov/contact-us",
    ],
    tags: ["government", "state", "cx", "support"],
  },
  {
    name: "New York",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: [
      "https://www.ny.gov/services",
      "https://dmv.ny.gov/contact-us",
    ],
    tags: ["government", "state", "cx", "support"],
  },
  {
    name: "Florida",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: [
      "https://www.myflorida.com/help/",
      "https://www.flhsmv.gov/contact-us/",
    ],
    tags: ["government", "state", "cx", "support"],
  },
  {
    name: "Illinois",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: [
      "https://www2.illinois.gov/sites/contactus/",
      "https://www.ilsos.gov/contactus/",
    ],
    tags: ["government", "state", "cx", "support"],
  },
  {
    name: "Ohio",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: [
      "https://ohio.gov/contact",
      "https://www.bmv.ohio.gov/contact-us.aspx",
    ],
    tags: ["government", "state", "cx", "support"],
  },
  {
    name: "Georgia",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: [
      "https://georgia.gov/contact-georgia",
      "https://dds.georgia.gov/contact-us",
    ],
    tags: ["government", "state", "cx", "support"],
  },
  {
    name: "Washington",
    industry: "government",
    subIndustry: "state-government",
    entityType: "government-state",
    sourceUrls: [
      "https://access.wa.gov/contact/",
      "https://www.dol.wa.gov/contact-us",
    ],
    tags: ["government", "state", "cx", "support"],
  },

  // ── Government - Counties (5) ───────────────────────────────
  {
    name: "Los Angeles County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: [
      "https://www.lacounty.gov/contact-us/",
      "https://www.lacounty.gov/residents/",
    ],
    tags: ["government", "county", "cx", "support"],
  },
  {
    name: "Cook County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: [
      "https://www.cookcountyil.gov/contact",
      "https://www.cookcountyil.gov/service/resident-services",
    ],
    tags: ["government", "county", "cx", "support"],
  },
  {
    name: "Harris County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: [
      "https://www.harriscountytx.gov/Contact-Us",
      "https://www.harriscountytx.gov/Government/Departments",
    ],
    tags: ["government", "county", "cx", "support"],
  },
  {
    name: "Maricopa County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: [
      "https://www.maricopa.gov/Directory.aspx",
      "https://www.maricopa.gov/5523/Contact-Us",
    ],
    tags: ["government", "county", "cx", "support"],
  },
  {
    name: "King County",
    industry: "government",
    subIndustry: "county-government",
    entityType: "government-county",
    sourceUrls: [
      "https://kingcounty.gov/en/legacy/about/contact-us",
      "https://kingcounty.gov/en/dept/executive/governance-leadership",
    ],
    tags: ["government", "county", "cx", "support"],
  },
];

export function getSeedIndustries(): string[] {
  return [...new Set(SEED_ENTITIES.map((e) => e.industry))];
}

export function getSeedEntitiesByIndustry(industry: string): SeedEntity[] {
  return SEED_ENTITIES.filter((e) => e.industry === industry);
}
