// Shared date/age utilities across Plan Inputs, SS Analyzer, and reports.
// Kept dead-simple to avoid any date-lib bloat.

// Age at year-end given a DOB year (approximation used everywhere the engine
// works at annual granularity). Returns null if inputs are missing.
export const ageAtYear = (dobYear, year) => {
  if (!dobYear || !year) return null;
  return year - dobYear;
};

// Convert an ISO date "YYYY-MM-DD" → integer year. Returns null if invalid.
export const yearOf = (isoDate) => {
  if (!isoDate) return null;
  const y = parseInt(String(isoDate).slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
};

// Age at an ISO date: integer years from DOB year to date's year (annual grain).
export const ageAtDate = (dobYear, isoDate) => {
  const y = yearOf(isoDate);
  return y == null ? null : ageAtYear(dobYear, y);
};

// Build an ISO date for "birthday age X" — {dobYear + X}-01-01. Used to default
// retirement / SS-claim dates. Returns "" if inputs missing.
export const isoAtAge = (dobYear, age) => {
  if (!dobYear || age == null) return "";
  return `${dobYear + age}-01-01`;
};

// Today as ISO "YYYY-MM-DD" (local time, but the year is what matters).
export const todayISO = () => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
};

// Start of the current year as ISO — used for the default wage start_date.
export const startOfCurrentYearISO = () => `${new Date().getFullYear()}-01-01`;

// Return the effective retirement date for an owner, honoring the
// `already_retired` flag which forces the date to today.
export const effectiveRetirementDate = (household, owner) => {
  if (!household) return null;
  const alreadyKey = owner === "Client" ? "client_already_retired" : "spouse_already_retired";
  const dateKey = owner === "Client" ? "client_retirement_date" : "spouse_retirement_date";
  if (household[alreadyKey]) return todayISO();
  if (household[dateKey]) return household[dateKey];
  // Legacy: derive from age
  const ageKey = owner === "Client" ? "client_retirement_age" : "spouse_retirement_age";
  const dobKey = owner === "Client" ? "client_dob_year" : "spouse_dob_year";
  if (household[ageKey] && household[dobKey]) return isoAtAge(household[dobKey], household[ageKey]);
  return null;
};

// Similar for the SS claim date. Default = client's 67th birthday when nothing set.
export const effectiveSsClaimDate = (household, owner) => {
  if (!household) return null;
  const dateKey = owner === "Client" ? "client_ss_claim_date" : "spouse_ss_claim_date";
  if (household[dateKey]) return household[dateKey];
  const ageKey = owner === "Client" ? "client_ss_claim_age" : "spouse_ss_claim_age";
  const dobKey = owner === "Client" ? "client_dob_year" : "spouse_dob_year";
  if (household[dobKey]) {
    const age = household[ageKey] || 67;
    return isoAtAge(household[dobKey], age);
  }
  return null;
};

// Derive integer SS claim age from a date, given DOB year. Falls back to legacy
// integer age field, then 67.
export const ssClaimAgeFor = (household, owner) => {
  if (!household) return 67;
  const isoDate = effectiveSsClaimDate(household, owner);
  const dobKey = owner === "Client" ? "client_dob_year" : "spouse_dob_year";
  const age = ageAtDate(household[dobKey], isoDate);
  return Number.isFinite(age) ? Math.max(62, Math.min(70, age)) : 67;
};

// Derive integer retirement age (year - dob_year) from a date, respecting
// `already_retired`. Falls back to legacy integer age. Returns null if nothing.
export const retirementAgeFor = (household, owner) => {
  if (!household) return null;
  const isoDate = effectiveRetirementDate(household, owner);
  const dobKey = owner === "Client" ? "client_dob_year" : "spouse_dob_year";
  const age = ageAtDate(household[dobKey], isoDate);
  if (Number.isFinite(age)) return age;
  const ageKey = owner === "Client" ? "client_retirement_age" : "spouse_retirement_age";
  return household[ageKey] ?? null;
};
