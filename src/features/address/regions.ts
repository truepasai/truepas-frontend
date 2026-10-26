import type { AddressCountry } from '@/types/domain';

/**
 * Pick-lists for the address form. Countries are the full ISO 3166-1 list;
 * only SUPPORTED_COUNTRIES can be saved today — the backend answers 422 for
 * anything else ("Only addresses in the US and India are supported."). When
 * it opens up more countries, add them to SUPPORTED_COUNTRIES (and widen
 * AddressCountry) and they become selectable.
 *
 * State lists mirror customer-account-service/app/address_schema.py, which
 * rejects any other value.
 */
export const SUPPORTED_COUNTRIES: readonly AddressCountry[] = ['US', 'IN'];

export function isSupportedCountry(code: string): code is AddressCountry {
  return (SUPPORTED_COUNTRIES as readonly string[]).includes(code);
}

/** 🇺🇸 from "US" (regional indicator letters). */
export function flagOf(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const ISO_COUNTRIES =
  'AF:Afghanistan|AX:Åland Islands|AL:Albania|DZ:Algeria|AS:American Samoa|AD:Andorra|AO:Angola|AI:Anguilla|' +
  'AQ:Antarctica|AG:Antigua and Barbuda|AR:Argentina|AM:Armenia|AW:Aruba|AU:Australia|AT:Austria|AZ:Azerbaijan|' +
  'BS:Bahamas|BH:Bahrain|BD:Bangladesh|BB:Barbados|BY:Belarus|BE:Belgium|BZ:Belize|BJ:Benin|BM:Bermuda|BT:Bhutan|' +
  'BO:Bolivia|BQ:Caribbean Netherlands|BA:Bosnia and Herzegovina|BW:Botswana|BV:Bouvet Island|BR:Brazil|' +
  'IO:British Indian Ocean Territory|BN:Brunei|BG:Bulgaria|BF:Burkina Faso|BI:Burundi|CV:Cape Verde|KH:Cambodia|' +
  'CM:Cameroon|CA:Canada|KY:Cayman Islands|CF:Central African Republic|TD:Chad|CL:Chile|CN:China|' +
  'CX:Christmas Island|CC:Cocos (Keeling) Islands|CO:Colombia|KM:Comoros|CG:Congo|CD:Congo (DRC)|CK:Cook Islands|' +
  'CR:Costa Rica|CI:Côte d’Ivoire|HR:Croatia|CU:Cuba|CW:Curaçao|CY:Cyprus|CZ:Czechia|DK:Denmark|DJ:Djibouti|' +
  'DM:Dominica|DO:Dominican Republic|EC:Ecuador|EG:Egypt|SV:El Salvador|GQ:Equatorial Guinea|ER:Eritrea|' +
  'EE:Estonia|SZ:Eswatini|ET:Ethiopia|FK:Falkland Islands|FO:Faroe Islands|FJ:Fiji|FI:Finland|FR:France|' +
  'GF:French Guiana|PF:French Polynesia|TF:French Southern Territories|GA:Gabon|GM:Gambia|GE:Georgia|DE:Germany|' +
  'GH:Ghana|GI:Gibraltar|GR:Greece|GL:Greenland|GD:Grenada|GP:Guadeloupe|GU:Guam|GT:Guatemala|GG:Guernsey|' +
  'GN:Guinea|GW:Guinea-Bissau|GY:Guyana|HT:Haiti|HM:Heard and McDonald Islands|VA:Vatican City|HN:Honduras|' +
  'HK:Hong Kong|HU:Hungary|IS:Iceland|IN:India|ID:Indonesia|IR:Iran|IQ:Iraq|IE:Ireland|IM:Isle of Man|IL:Israel|' +
  'IT:Italy|JM:Jamaica|JP:Japan|JE:Jersey|JO:Jordan|KZ:Kazakhstan|KE:Kenya|KI:Kiribati|KP:North Korea|' +
  'KR:South Korea|KW:Kuwait|KG:Kyrgyzstan|LA:Laos|LV:Latvia|LB:Lebanon|LS:Lesotho|LR:Liberia|LY:Libya|' +
  'LI:Liechtenstein|LT:Lithuania|LU:Luxembourg|MO:Macao|MG:Madagascar|MW:Malawi|MY:Malaysia|MV:Maldives|ML:Mali|' +
  'MT:Malta|MH:Marshall Islands|MQ:Martinique|MR:Mauritania|MU:Mauritius|YT:Mayotte|MX:Mexico|MD:Moldova|' +
  'MC:Monaco|MN:Mongolia|ME:Montenegro|MS:Montserrat|MA:Morocco|MZ:Mozambique|MM:Myanmar|NA:Namibia|NR:Nauru|' +
  'NP:Nepal|NL:Netherlands|NC:New Caledonia|NZ:New Zealand|NI:Nicaragua|NE:Niger|NG:Nigeria|NU:Niue|' +
  'NF:Norfolk Island|MK:North Macedonia|MP:Northern Mariana Islands|NO:Norway|OM:Oman|PK:Pakistan|PW:Palau|' +
  'PS:Palestine|PA:Panama|PG:Papua New Guinea|PY:Paraguay|PE:Peru|PH:Philippines|PN:Pitcairn Islands|PL:Poland|' +
  'PT:Portugal|PR:Puerto Rico|QA:Qatar|RE:Réunion|RO:Romania|RU:Russia|RW:Rwanda|BL:Saint Barthélemy|' +
  'SH:Saint Helena|KN:Saint Kitts and Nevis|LC:Saint Lucia|MF:Saint Martin|PM:Saint Pierre and Miquelon|' +
  'VC:Saint Vincent and the Grenadines|WS:Samoa|SM:San Marino|ST:São Tomé and Príncipe|SA:Saudi Arabia|' +
  'SN:Senegal|RS:Serbia|SC:Seychelles|SL:Sierra Leone|SG:Singapore|SX:Sint Maarten|SK:Slovakia|SI:Slovenia|' +
  'SB:Solomon Islands|SO:Somalia|ZA:South Africa|GS:South Georgia and South Sandwich Islands|SS:South Sudan|' +
  'ES:Spain|LK:Sri Lanka|SD:Sudan|SR:Suriname|SJ:Svalbard and Jan Mayen|SE:Sweden|CH:Switzerland|SY:Syria|' +
  'TW:Taiwan|TJ:Tajikistan|TZ:Tanzania|TH:Thailand|TL:Timor-Leste|TG:Togo|TK:Tokelau|TO:Tonga|' +
  'TT:Trinidad and Tobago|TN:Tunisia|TR:Türkiye|TM:Turkmenistan|TC:Turks and Caicos Islands|TV:Tuvalu|' +
  'UG:Uganda|UA:Ukraine|AE:United Arab Emirates|GB:United Kingdom|US:United States|' +
  'UM:U.S. Outlying Islands|UY:Uruguay|UZ:Uzbekistan|VU:Vanuatu|VE:Venezuela|VN:Vietnam|' +
  'VG:British Virgin Islands|VI:U.S. Virgin Islands|WF:Wallis and Futuna|EH:Western Sahara|YE:Yemen|' +
  'ZM:Zambia|ZW:Zimbabwe';

export interface CountryOption {
  code: string;
  name: string;
}

/** Supported countries first, then everything else A–Z. */
export const ADDRESS_COUNTRIES: CountryOption[] = (() => {
  const all = ISO_COUNTRIES.split('|').map((entry) => {
    const [code, name] = entry.split(':');
    return { code, name };
  });
  const supported = SUPPORTED_COUNTRIES.map((c) => all.find((a) => a.code === c)!).filter(Boolean);
  const rest = all.filter((a) => !isSupportedCountry(a.code)).sort((a, b) => a.name.localeCompare(b.name));
  return [...supported, ...rest];
})();

export function countryName(code: string): string {
  return ADDRESS_COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

/** Backend: a 2-letter code from this list (stored as the code). */
export const US_STATES: CountryOption[] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'],
  ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
].map(([code, name]) => ({ code, name }));

/** Backend: the full name (it also accepts the code, but stores the name). */
export const INDIAN_STATES: CountryOption[] = [
  ['AN', 'Andaman and Nicobar Islands'], ['AP', 'Andhra Pradesh'], ['AR', 'Arunachal Pradesh'], ['AS', 'Assam'],
  ['BR', 'Bihar'], ['CH', 'Chandigarh'], ['CG', 'Chhattisgarh'], ['DH', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['DL', 'Delhi'], ['GA', 'Goa'], ['GJ', 'Gujarat'], ['HR', 'Haryana'], ['HP', 'Himachal Pradesh'],
  ['JK', 'Jammu and Kashmir'], ['JH', 'Jharkhand'], ['KA', 'Karnataka'], ['KL', 'Kerala'], ['LA', 'Ladakh'],
  ['LD', 'Lakshadweep'], ['MP', 'Madhya Pradesh'], ['MH', 'Maharashtra'], ['MN', 'Manipur'], ['ML', 'Meghalaya'],
  ['MZ', 'Mizoram'], ['NL', 'Nagaland'], ['OD', 'Odisha'], ['PY', 'Puducherry'], ['PB', 'Punjab'],
  ['RJ', 'Rajasthan'], ['SK', 'Sikkim'], ['TN', 'Tamil Nadu'], ['TG', 'Telangana'], ['TR', 'Tripura'],
  ['UP', 'Uttar Pradesh'], ['UK', 'Uttarakhand'], ['WB', 'West Bengal'],
].map(([code, name]) => ({ code, name }));

/**
 * The value the backend wants for `state`, from what Google or the user gave:
 * US → the 2-letter code, IN → the canonical full name. Unknown → unchanged
 * (the picker shows it; the server's 422 names the field).
 */
export function normalizeState(country: AddressCountry, value: string): string {
  const v = value.trim();
  if (!v) return v;
  const list = country === 'US' ? US_STATES : INDIAN_STATES;
  const hit = list.find((s) => s.code.toLowerCase() === v.toLowerCase() || s.name.toLowerCase() === v.toLowerCase());
  if (!hit) return v;
  return country === 'US' ? hit.code : hit.name;
}
