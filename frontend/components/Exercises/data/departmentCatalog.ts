export const DEPARTMENT_IDS = [
  'civil',
  'mechanical',
  'electrical',
  'ece',
  'cse',
  'it',
  'chemical',
  'aerospace',
  'automobile',
  'biomedical',
] as const;

export type DepartmentId = (typeof DEPARTMENT_IDS)[number];

/** The class Exercise 3 judges. Exercise 2's scorecard uses the same class. */
export const DEPARTMENT_FOCUS: Record<DepartmentId, string> = {
  civil: 'Unsafe',
  mechanical: 'Fault',
  electrical: 'Fault',
  ece: 'Fail',
  cse: 'Bug',
  it: 'System Fault',
  chemical: 'Abnormal',
  aerospace: 'Unserviceable',
  automobile: 'Unsafe to Drive',
  biomedical: 'Device Fault',
};

export function departmentFocus(id: string): string | null {
  if (!DEPARTMENT_IDS.includes(id as DepartmentId)) return null;
  return DEPARTMENT_FOCUS[id as DepartmentId];
}

export interface DepartmentSource {
  id: DepartmentId;
  name: string;
  short: string;
  theme: string;
  about: string;
  source: string;
  use_case: string;
  description: string[];
  classes: string[];
}

export const DATASET_COLLECTION_ABOUT =
  'Ten independent text-classification packs, one per engineering department. Each row is a short field note plus one category. Use them to train TF-IDF or sentence embeddings with Logistic Regression.';

export const DATASET_COLLECTION_DESCRIPTION =
  'Each department file has 40,000 unique rows (400,000 in total). Classes are balanced two-way labels. Typical note length is about 50 words. Columns are id, text, and label.';

export const DEPARTMENT_SOURCES: DepartmentSource[] = [
  {
    id: 'civil',
    name: 'Civil Engineering',
    short: 'CIVIL',
    theme: 'Beams, columns, foundations, bridges',
    about:
      'A labeled pack of short inspection notes on beams, columns, foundations, and bridges. Each row is one visual or NDT round plus a Safe or Unsafe call.\n\nThe data came from construction and infrastructure inspection.',
    source:
      'Site walk-around notes, visual and NDT inspection reports, and structural check sheets on beams, columns, foundations, and bridges.',
    use_case:
      'Flag a structure as Safe or Unsafe from a short inspection note so the site team knows whether to keep using it. A closed check can stay in service; a defect that needs repair or restricted use is held before the next cycle.',
    description: [
      'Check closed with no findings',
      'Defect that needs repair or restricted use',
    ],
    classes: ['Safe', 'Unsafe'],
  },
  {
    id: 'mechanical',
    name: 'Mechanical Engineering',
    short: 'MECH',
    theme: 'Pumps, gearboxes, motors, bearings',
    about:
      'A labeled pack of shift-round notes on pumps, gearboxes, motors, and bearings. Each row is what the tech heard or measured, plus a Normal or Fault call.\n\nThe data came from industrial plant and rotating-equipment maintenance.',
    source:
      'Shift-round logs from pumps, gearboxes, motors, and bearings — what the technician heard, felt, or measured on the shop floor.',
    use_case:
      'Sort a maintenance round into Normal or Fault so the crew knows whether the machine can stay on duty. In-spec readings keep running; vibration, heat, or wear that needs a stop is flagged on the same shift.',
    description: [
      'Readings stay inside duty',
      'Vibration, heat, or wear that needs a stop',
    ],
    classes: ['Normal', 'Fault'],
  },
  {
    id: 'electrical',
    name: 'Electrical Engineering',
    short: 'EEE',
    theme: 'Transformers, breakers, feeders, relays',
    about:
      'A labeled pack of field notes from transformers, breakers, feeders, relays, and switchgear. Each row is a short circuit complaint plus a Normal or Fault call.\n\nThe data came from utility and plant electrical operations.',
    source:
      'Maintenance logs, inspection reports, SCADA/alarm notes, and shift electrician rounds from substations and plant switchgear.',
    use_case:
      'Sort a same-shift electrical note as Normal or Fault so the crew knows whether the circuit can stay in service.',
    description: [
      'Readings stay inside the rating',
      'A stop or extra check is needed',
    ],
    classes: ['Normal', 'Fault'],
  },
  {
    id: 'ece',
    name: 'Electronics and Communication',
    short: 'ECE',
    theme: 'Boards, RF links, firmware, rails',
    about:
      'A labeled pack of bench and field notes on boards, RF links, firmware, and supply rails. Each row is a device check plus a Pass or Fail call.\n\nThe data came from electronics manufacturing, embedded systems, and comms links.',
    source: 'Bench and field notes from board bring-up, RF links, firmware drops, and supply-rail checks.',
    use_case:
      'Call a bench or field check Pass or Fail so a board, link, or rail that missed spec is held before it ships.',
    description: [
      'Held inside the expected band',
      'Missed spec on the bench or in the field',
    ],
    classes: ['Pass', 'Fail'],
  },
  {
    id: 'cse',
    name: 'Computer Science',
    short: 'CSE',
    theme: 'Auth, payments, search, APIs',
    about:
      'A labeled pack of issue-tracker tickets from auth, payments, search, and related services. Each row is a short ticket plus a Bug or Working as Intended call.\n\nThe data came from software product engineering and SaaS incidents.',
    source: 'Issue-tracker tickets from auth, payments, search, and related product services.',
    use_case:
      'Sort a live ticket as Bug or Working as Intended so a real defect is not filed as expected behaviour.',
    description: [
      'Broken behaviour in a live feature',
      'The product behaved as designed',
    ],
    classes: ['Bug', 'Working as Intended'],
  },
  {
    id: 'it',
    name: 'Information Technology',
    short: 'IT',
    theme: 'Laptops, apps, wifi, logins',
    about:
      'A labeled pack of help-desk tickets on laptops, apps, wifi, printers, and logins. Each row is a one-shift symptom plus a User Error or System Fault call.\n\nThe data came from campus and office IT support.',
    source: 'Campus and office help-desk tickets about laptops, apps, wifi, printers, and logins.',
    use_case:
      'Send a first-line ticket to User Error or System Fault so the desk knows whether to coach the person or fix the kit.',
    description: [
      'The person used the system the wrong way',
      'The kit or service actually failed',
    ],
    classes: ['User Error', 'System Fault'],
  },
  {
    id: 'chemical',
    name: 'Chemical Engineering',
    short: 'CHEM',
    theme: 'Reactors, columns, exchangers, utilities',
    about:
      'A labeled pack of shift logs from reactors, columns, exchangers, and plant utilities. Each row is a unit reading plus a Normal or Abnormal call.\n\nThe data came from process-plant and petrochemical operations.',
    source: 'Board-operator shift logs from reactors, columns, exchangers, and plant utilities.',
    use_case:
      'File a unit log as Normal or Abnormal for the next shift so drift on the unit is not mixed with an in-spec run.',
    description: [
      'Run stayed in spec',
      'Yield, kit, or hazard drifted off spec',
    ],
    classes: ['Normal', 'Abnormal'],
  },
  {
    id: 'aerospace',
    name: 'Aerospace Engineering',
    short: 'AERO',
    theme: 'Airframe, engines, instruments',
    about:
      'A labeled pack of flight and hangar notes on airframe, engines, landing gear, and instruments. Each row is a short quality or crew note plus a Serviceable or Unserviceable call.\n\nThe data came from civil aviation maintenance.',
    source: 'Hangar and flight-crew notes on airframe, engines, landing gear, and instruments.',
    use_case:
      'Call a pre-cycle note Serviceable or Unserviceable so the hangar knows whether the aircraft can fly.',
    description: [
      'Fit to fly this cycle',
      'Hold the aircraft until it is cleared',
    ],
    classes: ['Serviceable', 'Unserviceable'],
  },
  {
    id: 'automobile',
    name: 'Automobile Engineering',
    short: 'AUTOMOBILE',
    theme: 'Powertrain, brakes, vehicle electrics, ride',
    about:
      'A labeled pack of workshop diagnosis notes from cars in for repair. Each row is a driver complaint plus a Safe to Drive or Unsafe to Drive call.\n\nThe data came from after-sales vehicle diagnostics.',
    source: 'Workshop diagnosis notes from cars in for repair — driver complaints plus what the tech observed.',
    use_case:
      'Route a vehicle complaint as Safe to Drive or Unsafe to Drive so a no-go car is not released.',
    description: [
      'The car can leave the bay',
      'Hold the car until the defect is cleared',
    ],
    classes: ['Safe to Drive', 'Unsafe to Drive'],
  },
  {
    id: 'biomedical',
    name: 'Biomedical Engineering',
    short: 'BME',
    theme: 'Pumps, monitors, ventilators',
    about:
      'A labeled pack of clinical-equipment service notes on infusion pumps, patient monitors, and ventilators. Each row is a device ticket plus a Device Fault or No Fault Found call.\n\nThe data came from hospital biomedical workshops.',
    source: 'Hospital work orders on infusion pumps, patient monitors, ventilators, and other clinical devices.',
    use_case:
      'Triage a device ticket as Device Fault or No Fault Found so broken hardware is not sent back as a use issue.',
    description: [
      'The device itself failed',
      'Nothing wrong with the hardware',
    ],
    classes: ['Device Fault', 'No Fault Found'],
  },
];

export const GENERIC_FORMAT_SAMPLES = [
  {
    text: 'The login API returns 500 when the session token expires.',
    label: 'Bug',
  },
  {
    text: 'Export is PDF-only because that is how the product was specified.',
    label: 'Working as Intended',
  },
  {
    text: 'Guest wifi drops every few minutes on the office network.',
    label: 'System Fault',
  },
];

export function getDepartmentSource(id: string): DepartmentSource | null {
  return DEPARTMENT_SOURCES.find((item) => item.id === id) ?? null;
}

export type DepartmentConceptPack = {
  pair: string;
  samples: Array<{ label: string; text: string }>;
  cuts: Array<{ raw: string; keep: string }>;
  countRepeat: string;
  countOnce: string;
  countOnceWord: string;
  missWord: string;
  rareWord: string;
  weakWord: string;
  pullWord: string;
  pullClass: string;
  tiny: [string, string, string];
  reuse: string;
  unseen: string;
  missActual: string;
  missPred: string;
  keyword: string;
  paraphrase: string;
  embedLeft: string;
  embedRight: string;
};

export const DEPARTMENT_CONCEPT: Record<DepartmentId, DepartmentConceptPack> = {
  civil: {
    pair: 'south abutment',
    samples: [
      { label: 'Safe', text: 'Weld at pier 3 checked clean after the monsoon load.' },
      { label: 'Unsafe', text: 'Crack at the south abutment after monsoon load.' },
    ],
    cuts: [
      { raw: 'The beam is cracked at the weld.', keep: 'beam, cracked, weld' },
      { raw: 'The deck is dry with no visible defect.', keep: 'deck, dry, visible, defect' },
    ],
    countRepeat: 'Crack at the abutment, then another crack at midspan.',
    countOnce: 'Bearing pad sits within the design gap.',
    countOnceWord: 'bearing',
    missWord: 'spalling',
    rareWord: 'spalling',
    weakWord: 'reported',
    pullWord: 'crack',
    pullClass: 'Unsafe',
    tiny: ['crack beam', 'safe deck', 'dry pier'],
    reuse: 'crack',
    unseen: 'girder',
    missActual: 'Unsafe',
    missPred: 'Safe',
    keyword: 'Crack at the south abutment after monsoon load.',
    paraphrase: 'The pier has a fracture that was not there last season.',
    embedLeft: 'the beam is cracked',
    embedRight: 'fracture observed in the girder',
  },
  mechanical: {
    pair: 'gearbox vibration',
    samples: [
      { label: 'Normal', text: 'Pump bearing temperature sits inside the duty band.' },
      { label: 'Fault', text: 'Gearbox vibration sits above the duty rating.' },
    ],
    cuts: [
      { raw: 'The gearbox is vibrating above the rating.', keep: 'gearbox, vibrating, rating' },
      { raw: 'Oil level on the pump is steady and cool.', keep: 'oil, level, pump, steady, cool' },
    ],
    countRepeat: 'Vibration on the gearbox, then more vibration at the coupling.',
    countOnce: 'Motor current stays inside the nameplate.',
    countOnceWord: 'current',
    missWord: 'seized',
    rareWord: 'seized',
    weakWord: 'during',
    pullWord: 'vibration',
    pullClass: 'Fault',
    tiny: ['gearbox vibration', 'pump normal', 'cool oil'],
    reuse: 'vibration',
    unseen: 'coupling',
    missActual: 'Fault',
    missPred: 'Normal',
    keyword: 'Gearbox vibration sits above the duty rating.',
    paraphrase: 'The rotating unit is shaking harder than it should.',
    embedLeft: 'bearing is seized',
    embedRight: 'the rotating element will not turn',
  },
  electrical: {
    pair: 'voltage sag',
    samples: [
      { label: 'Normal', text: 'Feeder current sits inside the rating at peak load.' },
      { label: 'Fault', text: 'Breaker failed to clear the short on the first trip.' },
    ],
    cuts: [
      { raw: 'The feeder shows a voltage sag at peak.', keep: 'feeder, voltage, sag, peak' },
      { raw: 'Relay did not trip as designed.', keep: 'relay, trip, designed' },
    ],
    countRepeat: 'Voltage sag, then another voltage sag on the same feeder.',
    countOnce: 'Tap change completed on the transformer.',
    countOnceWord: 'tap',
    missWord: 'brownout',
    rareWord: 'brownout',
    weakWord: 'reported',
    pullWord: 'trip',
    pullClass: 'Fault',
    tiny: ['failed trip', 'in rating', 'hot bushing'],
    reuse: 'trip',
    unseen: 'islanding',
    missActual: 'Fault',
    missPred: 'Normal',
    keyword: 'Breaker failed to clear the short on the first trip.',
    paraphrase: 'The protection stayed silent when the line shorted.',
    embedLeft: 'breaker did not trip',
    embedRight: 'the protection stayed silent on the short',
  },
  ece: {
    pair: 'header contact',
    samples: [
      { label: 'Pass', text: 'GPS receiver holds a lock after the header reseat.' },
      { label: 'Fail', text: 'GPS receiver has an intermittent header contact.' },
    ],
    cuts: [
      { raw: 'The GPS header contact is intermittent.', keep: 'gps, header, contact, intermittent' },
      { raw: 'The 3V3 rail will not hold.', keep: 'rail, hold' },
    ],
    countRepeat: 'Header contact fail, then another header contact fail after reseat.',
    countOnce: 'Firmware boots clean after the flash.',
    countOnceWord: 'firmware',
    missWord: 'spurious',
    rareWord: 'spurious',
    weakWord: 'during',
    pullWord: 'header',
    pullClass: 'Fail',
    tiny: ['header contact', 'rail drop', 'clean boot'],
    reuse: 'header',
    unseen: 'oscillator',
    missActual: 'Fail',
    missPred: 'Pass',
    keyword: 'GPS receiver has an intermittent header contact.',
    paraphrase: 'The connector on the board is making a poor join.',
    embedLeft: 'the 3V3 rail collapsed',
    embedRight: 'the supply would not stay up under load',
  },
  cse: {
    pair: 'null pointer',
    samples: [
      { label: 'Bug', text: 'Auth module throws a null pointer on submit.' },
      { label: 'Working as Intended', text: 'Export is PDF-only because that is how the product was specified.' },
    ],
    cuts: [
      { raw: 'The login throws a null pointer.', keep: 'login, throws, null, pointer' },
      { raw: 'The password reset is not hashed.', keep: 'password, reset, hashed' },
    ],
    countRepeat: 'Null pointer on submit, then another null pointer on retry.',
    countOnce: 'Dashboard export was filed as specified.',
    countOnceWord: 'export',
    missWord: 'SQLi',
    rareWord: 'SQLi',
    weakWord: 'reported',
    pullWord: 'null',
    pullClass: 'Bug',
    tiny: ['null login', 'pdf export', 'token leak'],
    reuse: 'null',
    unseen: 'graphql',
    missActual: 'Bug',
    missPred: 'Working as Intended',
    keyword: 'Auth module throws a null pointer on submit.',
    paraphrase: 'The sign-in path crashes when a field is empty.',
    embedLeft: 'cannot sign in',
    embedRight: 'the login path crashes on an empty field',
  },
  it: {
    pair: 'guest VPN',
    samples: [
      { label: 'User Error', text: 'Student entered the old wifi password on the guest SSID.' },
      { label: 'System Fault', text: 'Guest VPN drops every few minutes.' },
    ],
    cuts: [
      { raw: 'The guest VPN drops every few minutes.', keep: 'guest, vpn, drops, minutes' },
      { raw: 'The printer jam will not clear.', keep: 'printer, jam, clear' },
    ],
    countRepeat: 'VPN drop, then another VPN drop on the same laptop.',
    countOnce: 'Password reset mail reached the inbox.',
    countOnceWord: 'password',
    missWord: 'lockout',
    rareWord: 'lockout',
    weakWord: 'during',
    pullWord: 'vpn',
    pullClass: 'System Fault',
    tiny: ['guest vpn', 'old password', 'printer jam'],
    reuse: 'vpn',
    unseen: 'eduroam',
    missActual: 'System Fault',
    missPred: 'User Error',
    keyword: 'Guest VPN drops every few minutes.',
    paraphrase: 'The remote link keeps falling off the office wifi.',
    embedLeft: 'cannot reach the share',
    embedRight: 'the wifi keeps dropping on its own',
  },
  chemical: {
    pair: 'reactor yield',
    samples: [
      { label: 'Normal', text: 'Column pressure sat in spec for the whole shift.' },
      { label: 'Abnormal', text: 'Reactor yield is poor and the loop is unstable.' },
    ],
    cuts: [
      { raw: 'The reactor yield is poor and unstable.', keep: 'reactor, yield, poor, unstable' },
      { raw: 'The column pressure sat in spec.', keep: 'column, pressure, sat, spec' },
    ],
    countRepeat: 'Yield drop, then another yield drop after the feed change.',
    countOnce: 'Setpoint trim on the reflux.',
    countOnceWord: 'reflux',
    missWord: 'runaway',
    rareWord: 'runaway',
    weakWord: 'during',
    pullWord: 'runaway',
    pullClass: 'Abnormal',
    tiny: ['reactor yield', 'in spec', 'fouled bundle'],
    reuse: 'yield',
    unseen: 'azeotrope',
    missActual: 'Abnormal',
    missPred: 'Normal',
    keyword: 'Reactor yield is poor and the loop is unstable.',
    paraphrase: 'The unit is not making the expected product and the control is hunting.',
    embedLeft: 'the reactor ran away',
    embedRight: 'temperature climbed with no control left',
  },
  aerospace: {
    pair: 'landing gear',
    samples: [
      { label: 'Serviceable', text: 'Scheduled filter change completed before the next cycle.' },
      { label: 'Unserviceable', text: 'Landing gear will not extend on approach.' },
    ],
    cuts: [
      { raw: 'The landing gear will not extend.', keep: 'landing, gear, extend' },
      { raw: 'The attitude indicator drifts on start.', keep: 'attitude, indicator, drifts, start' },
    ],
    countRepeat: 'Gear fail to extend, then another gear fail on the retest.',
    countOnce: 'Filter change logged before dispatch.',
    countOnceWord: 'filter',
    missWord: 'uncommanded',
    rareWord: 'uncommanded',
    weakWord: 'reported',
    pullWord: 'gear',
    pullClass: 'Unserviceable',
    tiny: ['landing gear', 'filter change', 'indicator drift'],
    reuse: 'gear',
    unseen: 'aileron',
    missActual: 'Unserviceable',
    missPred: 'Serviceable',
    keyword: 'Landing gear will not extend on approach.',
    paraphrase: 'The wheels would not come down before landing.',
    embedLeft: 'uncommanded pitch',
    embedRight: 'the nose moved by itself',
  },
  automobile: {
    pair: 'rough idle',
    samples: [
      { label: 'Safe to Drive', text: 'Battery lamp cleared after a short charge.' },
      { label: 'Unsafe to Drive', text: 'Pedal sinks on a long downhill hold.' },
    ],
    cuts: [
      { raw: 'Rough idle when the engine is cold.', keep: 'rough, idle, engine, cold' },
      { raw: 'The pedal sinks on a long hold.', keep: 'pedal, sinks, long, hold' },
    ],
    countRepeat: 'Rough idle, then another rough idle after the restart.',
    countOnce: 'Battery lamp cleared after the charge.',
    countOnceWord: 'battery',
    missWord: 'misfire',
    rareWord: 'misfire',
    weakWord: 'during',
    pullWord: 'pedal',
    pullClass: 'Unsafe to Drive',
    tiny: ['pedal sink', 'lamp cleared', 'damper knock'],
    reuse: 'pedal',
    unseen: 'turbo',
    missActual: 'Unsafe to Drive',
    missPred: 'Safe to Drive',
    keyword: 'Pedal sinks on a long downhill hold.',
    paraphrase: 'The brakes would not hold on the slope.',
    embedLeft: 'the pedal went to the floor',
    embedRight: 'brakes would not hold on the slope',
  },
  biomedical: {
    pair: 'self-test',
    samples: [
      { label: 'Device Fault', text: 'Patient monitor fails self-test on power-up.' },
      { label: 'No Fault Found', text: 'Leads were swapped on the chest set.' },
    ],
    cuts: [
      { raw: 'Monitor fails self-test on power-up.', keep: 'monitor, fails, self-test, power-up' },
      { raw: 'Leads were swapped on the chest set.', keep: 'leads, swapped, chest, set' },
    ],
    countRepeat: 'Self-test fail, then another self-test fail after reboot.',
    countOnce: 'Filter service logged on the ventilator.',
    countOnceWord: 'filter',
    missWord: 'occlusion',
    rareWord: 'occlusion',
    weakWord: 'reported',
    pullWord: 'monitor',
    pullClass: 'Device Fault',
    tiny: ['self-test fail', 'leads swapped', 'volume check'],
    reuse: 'monitor',
    unseen: 'spo2',
    missActual: 'Device Fault',
    missPred: 'No Fault Found',
    keyword: 'Patient monitor fails self-test on power-up.',
    paraphrase: 'The bedside screen will not pass its start check.',
    embedLeft: 'the pump is out of spec',
    embedRight: 'delivered volume does not match the setting',
  },
};

export function getDepartmentConcept(id: string): DepartmentConceptPack | null {
  if (!DEPARTMENT_IDS.includes(id as DepartmentId)) return null;
  return DEPARTMENT_CONCEPT[id as DepartmentId];
}

/** nRows 0 = not known yet: the server sends the real count with the first page (screens fall back to the rows loaded). */
export function departmentSourceToMeta(source: DepartmentSource, nRows = 0) {
  return {
    id: source.id,
    name: source.name,
    short: source.short,
    theme: source.theme,
    source: source.source,
    use_case: source.use_case,
    classes: source.classes,
    n_rows: nRows,
  };
}
