const MARKUP_RATE = 0.30;
const VAT_RATE = 0.20;

const SCHEDULES = Object.freeze({
  SCALE_1: Object.freeze([[1,19,1500],[20,99,1250],[100,null,1000]]),
  SCALE_2: Object.freeze([[1,9,2500],[10,19,2000],[20,99,1750],[100,null,1500]]),
  SCALE_3: Object.freeze([[1,9,17500],[10,19,15500],[20,49,13500],[50,99,11500],[100,null,9500]]),
  SHORT: Object.freeze([[1,99,500],[100,null,400]]),
  FIRST_AID_WORK: Object.freeze([[1,9,1000],[10,null,750]]),
  FIRST_AID_EMERGENCY: Object.freeze([[1,9,750],[10,null,500]]),
  SPECIALIST_SPECTATOR: Object.freeze([[1,9,11500],[10,49,10500],[50,99,9500],[100,null,8500]]),
  SPECIALIST_WAREHOUSING: Object.freeze([[1,9,8000],[10,49,7500],[50,99,7000],[100,null,6500]]),
  CARE_CERTIFICATE: Object.freeze([[1,9,3500],[10,99,3000],[100,null,2500]]),
  CARE_STANDARD: Object.freeze([[1,null,250]]),
  LEVEL_2_MODULE: Object.freeze([[1,null,450]]),
  LEVEL_3_MODULE: Object.freeze([[1,null,2000]]),
});

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const groups = [
  ['SCALE_1', [
    'An Awareness of Mental Health and Wellbeing',
    'Asbestos Awareness',
    'Food Safety Level 1',
    'Health and Safety Level 1',
    'Health and Safety within a Construction Environment Level 1',
    'Introduction to Allergens',
    'Information and Data Security',
    'Introduction to Environmental Awareness',
    'Introduction to Working at Height',
    'Manual Handling',
  ]],
  ['SCALE_2', [
    'Customer Service Level 2',
    'Food Safety Level 2',
    'Food Safety for Manufacturing Level 2',
    'Introduction to HACCP',
    'Health and Safety Level 2',
    'Principles of the Role of a Fire Marshal Level 2',
    'Personal Licence Holders Level 2',
    'Scottish Certificate for Personal Licence Holders Level 6',
  ]],
  ['SCALE_3', [
    'Food Safety Level 3',
    'HACCP Level 3 Catering',
    'HACCP Level 3 Manufacturing',
    'Health and Safety Level 3',
    'Health and Safety Management in Health Care Level 3',
  ]],
  ['SHORT', [
    'Anaphylaxis and Autoinjectors',
    'Awareness of Home Working',
    'Awareness of Lone Working',
    'Awareness of Menopause in the Workplace',
    'Awareness of Modern Slavery',
    'Awareness of Sexual Harassment in the Workplace for Employees',
    'Awareness of Sexual Harassment in the Workplace for Managers',
    'Communication',
    'Challenge - Responsible Sales in Hospitality and Retail',
    'Display Screen Equipment',
    'Effective Writing in the Workplace',
    'Equality and Diversity',
    'General Data Protection Regulation (GDPR)',
    'Infection Prevention and Control',
    'Introduction to the Bribery Act 2010',
    'Introduction to Fire Safety in the Workplace',
    'Introduction to Fraud and Fraud Prevention',
    'Introduction to the Prevention of Money Laundering',
    'Introduction to Neurodiversity Awareness',
    'Managing Conflict',
    'Mental Health Awareness for Managers',
    'Safeguarding Children',
    'Self-awareness and Personal Development',
    'STARS (Scottish Training for Alcohol Retailers and Servers)',
    'Stress Management',
    'Team Working',
  ]],
  ['FIRST_AID_WORK', ['First Aid at Work']],
  ['FIRST_AID_EMERGENCY', ['Emergency First Aid at Work','Paediatric First Aid']],
  ['SPECIALIST_SPECTATOR', [
    'An Awareness of Spectator Safety',
    'An Awareness of Understanding Stewarding at Spectator Events',
  ]],
  ['SPECIALIST_WAREHOUSING', ['An Awareness of Warehousing and Storage']],
  ['CARE_CERTIFICATE', ['Care Certificate']],
  ['CARE_STANDARD', [
    'Care Certificate Standard: Understand Your Role',
    'Care Certificate Standard: Your Personal Development',
    'Care Certificate Standard: Duty of Care',
    'Care Certificate Standard: Equality and Diversity',
    'Care Certificate Standard: Working in a Person-Centred Way',
    'Care Certificate Standard: Communication',
    'Care Certificate Standard: Privacy and Dignity',
    'Care Certificate Standard: Fluids and Nutrition',
    'Care Certificate Standard: Mental Health, Dementia and Learning Disability',
    'Care Certificate Standard: Safeguarding Adults',
    'Care Certificate Standard: Safeguarding Children',
    'Care Certificate Standard: Basic Life Support',
    'Care Certificate Standard: Health and Safety',
    'Care Certificate Standard: Handling Information',
    'Care Certificate Standard: Infection Prevention and Control',
  ]],
  ['LEVEL_2_MODULE', [
    'Level 2 Food Safety Module: Cleaning and Disinfection',
    'Level 2 Food Safety Module: Contamination Hazards and Controls',
    'Level 2 Food Safety Module: Food Pests and Control',
    'Level 2 Food Safety Module: Food Poisoning and Its Control',
    'Level 2 Food Safety Module: Food Premises and Equipment',
    'Level 2 Food Safety Module: Food Safety Enforcement',
    'Level 2 Food Safety Module: HACCP from Delivery to Service',
    'Level 2 Food Safety Module: Introduction to Food Safety',
    'Level 2 Food Safety Module: Microbiological Hazards',
    'Level 2 Food Safety Module: Personal Hygiene',
    'Level 2 Health and Safety Module: Accidents Including Slips, Trips and Falls',
    'Level 2 Health and Safety Module: Fire',
    'Level 2 Health and Safety Module: First Aid',
    'Level 2 Health and Safety Module: Hazardous Substances (COSHH)',
    'Level 2 Health and Safety Module: Legal Responsibilities',
    'Level 2 Health and Safety Module: Risk Assessment',
    'Level 2 Health and Safety Module: Work Equipment',
    'Level 2 Health and Safety Module: Workplace Health, Safety and Welfare',
  ]],
  ['LEVEL_3_MODULE', [
    'Level 3 Health and Safety Module: Accident, Injuries and Work-Related Health',
    'Level 3 Health and Safety Module: Ergonomics',
    'Level 3 Health and Safety Module: Manual Handling and Display Screen Equipment',
    'Level 3 Health and Safety Module: Fire Safety',
    'Level 3 Health and Safety Module: Hazardous Substances (COSHH)',
    'Level 3 Health and Safety Module: Introduction to Health and Safety',
    'Level 3 Health and Safety Module: Legal Aspects of Health and Safety',
    'Level 3 Health and Safety Module: Measuring and Monitoring Performance',
    'Level 3 Health and Safety Module: Risk Assessment',
    'Level 3 Health and Safety Module: The Role of Line Managers and Supervisors',
    'Level 3 Health and Safety Module: The Workplace',
    'Level 3 Health and Safety Module: Using Equipment Safely',
  ]],
];

const MANIFEST = new Map();
for (const [scheduleCode, titles] of groups) {
  for (const title of titles) {
    const id = `hf-${slugify(title)}`;
    if (MANIFEST.has(id)) throw new Error(`Duplicate Professional Training course ${id}`);
    MANIFEST.set(id, Object.freeze({ id, title, scheduleCode }));
  }
}

if (MANIFEST.size !== 101) {
  throw new Error(`Professional Training payment manifest expected 101 courses, found ${MANIFEST.size}.`);
}

export const PROFESSIONAL_TRAINING_COURSE_COUNT = MANIFEST.size;

export function professionalTrainingCourse(courseId) {
  return MANIFEST.get(String(courseId || '').trim()) || null;
}

export function professionalTrainingPrice(courseId, quantity) {
  const course = professionalTrainingCourse(courseId);
  const qty = Number(quantity);
  if (!course || !Number.isInteger(qty) || qty < 1 || qty > 25) return null;
  const schedule = SCHEDULES[course.scheduleCode];
  const tier = schedule.find(([minimum, maximum]) => qty >= minimum && (maximum === null || qty <= maximum));
  if (!tier) return null;
  const providerRetailPence = Number(tier[2]);
  const netPence = Math.round(providerRetailPence * (1 + MARKUP_RATE));
  const vatPence = Math.round(netPence * VAT_RATE);
  return Object.freeze({
    ...course,
    quantity: qty,
    providerRetailPence,
    unitNetPence: netPence,
    unitVatPence: vatPence,
    unitGrossPence: netPence + vatPence,
    lineNetPence: netPence * qty,
    lineVatPence: vatPence * qty,
    lineGrossPence: (netPence + vatPence) * qty,
    currency: 'GBP',
  });
}
