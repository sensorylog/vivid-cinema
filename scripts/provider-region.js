const STORAGE_KEY="vivid:provider-country";
const SUPPORTED=Object.freeze(["US","GH","GB","CA","NG","ZA","AU"]);

function browserCountry(){
  const languages=Array.isArray(navigator.languages)&&navigator.languages.length?navigator.languages:[navigator.language||""];
  for(const language of languages){
    const match=String(language).match(/[-_]([A-Z]{2})$/i);
    if(match&&SUPPORTED.includes(match[1].toUpperCase()))return match[1].toUpperCase();
  }
  return null;
}

export function getProviderCountry(fallback="US"){
  try{
    const stored=localStorage.getItem(STORAGE_KEY)?.toUpperCase();
    if(SUPPORTED.includes(stored))return stored;
  }catch{}
  return browserCountry()||fallback;
}

export function setProviderCountry(country){
  const value=String(country||"").toUpperCase();
  if(!SUPPORTED.includes(value))return getProviderCountry();
  try{localStorage.setItem(STORAGE_KEY,value)}catch{}
  window.dispatchEvent(new CustomEvent("vivid:provider-country-changed",{detail:{country:value}}));
  return value;
}

export function getSupportedProviderCountries(){
  return [...SUPPORTED];
}
