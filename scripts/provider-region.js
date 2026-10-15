import { tmdbApi } from "./tmdb.js";

const STORAGE_KEY = "vivid:provider-country";
const FALLBACK_COUNTRIES = [
  ["US", "United States"], ["GH", "Ghana"], ["GB", "United Kingdom"],
  ["CA", "Canada"], ["NG", "Nigeria"], ["ZA", "South Africa"],
  ["AU", "Australia"], ["DE", "Germany"], ["FR", "France"],
  ["ES", "Spain"], ["IT", "Italy"], ["NL", "Netherlands"],
  ["BE", "Belgium"], ["CH", "Switzerland"], ["AT", "Austria"],
  ["IE", "Ireland"], ["PT", "Portugal"], ["SE", "Sweden"],
  ["NO", "Norway"], ["DK", "Denmark"], ["FI", "Finland"],
  ["PL", "Poland"], ["GR", "Greece"], ["TR", "Türkiye"],
  ["IN", "India"], ["PK", "Pakistan"], ["BD", "Bangladesh"],
  ["PH", "Philippines"], ["ID", "Indonesia"], ["MY", "Malaysia"],
  ["SG", "Singapore"], ["TH", "Thailand"], ["JP", "Japan"],
  ["KR", "South Korea"], ["CN", "China"], ["BR", "Brazil"],
  ["MX", "Mexico"], ["AR", "Argentina"], ["CL", "Chile"],
  ["CO", "Colombia"], ["EG", "Egypt"], ["KE", "Kenya"],
  ["UG", "Uganda"], ["TZ", "Tanzania"], ["RW", "Rwanda"],
  ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"],
  ["IL", "Israel"], ["NZ", "New Zealand"]
];
let providerCountries = FALLBACK_COUNTRIES.map(([code, label]) => [code, label]);
let providerCountriesPromise = null;

export function normalizeProviderCountryOptions(items = []) {
  const list = Array.isArray(items) ? items : items?.results || items?.countries || [];
  const byCode = new Map();
  for (const item of list) {
    const code = String(item?.iso_3166_1 || item?.code || "").toUpperCase();
    const label = String(item?.english_name || item?.name || item?.native_name || "").trim();
    if (!/^[A-Z]{2}$/.test(code) || !label || byCode.has(code)) continue;
    byCode.set(code, label);
  }
  return [...byCode.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

export async function loadSupportedProviderCountries() {
  if (providerCountriesPromise) return providerCountriesPromise;
  providerCountriesPromise = tmdbApi.countries().then(payload => {
    const options = normalizeProviderCountryOptions(payload);
    if (options.length) providerCountries = options;
    return getSupportedProviderCountryOptions();
  }).catch(() => {
    providerCountriesPromise = null;
    return getSupportedProviderCountryOptions();
  });
  return providerCountriesPromise;
}

export function getSupportedProviderCountryOptions() {
  return providerCountries.map(([code, label]) => [code, label]);
}

export function getSupportedProviderCountries() {
  return providerCountries.map(([code]) => code);
}

export function getProviderCountryName(country) {
  const code = String(country || "").toUpperCase();
  return providerCountries.find(([itemCode]) => itemCode === code)?.[1] || code;
}

function browserCountry() {
  const languages = typeof navigator !== "undefined" && Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [typeof navigator !== "undefined" ? navigator.language || "" : ""];
  for (const language of languages) {
    const match = String(language).match(/[-_]([A-Z]{2})$/i);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

export function getProviderCountry(fallback = "US") {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)?.toUpperCase();
    if (/^[A-Z]{2}$/.test(stored || "")) return stored;
  } catch {}
  return browserCountry() || fallback;
}

export function setProviderCountry(country) {
  const value = String(country || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) return getProviderCountry();
  try { localStorage.setItem(STORAGE_KEY, value); } catch {}
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("vivid:provider-country-changed", { detail: { country: value } }));
  }
  return value;
}
