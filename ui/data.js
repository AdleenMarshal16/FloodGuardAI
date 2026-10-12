// Static safety content + indicative evacuation routes (verify with district authorities).
const NUMBERS = [
  ['National emergency', '112'], ['Ambulance', '108'], ['Fire & rescue', '101'], ['Police', '100'],
  ['Disaster helpline (district control room)', '1077'], ['KSDMA Kerala', '1070'], ['Women helpline', '1091'], ['Child helpline', '1098']];
const FIRST_AID = {
  'Drowning / near-drowning': ['Call 108 immediately.', 'Pull the person out without entering deep water yourself; reach with a pole or rope.', 'If not breathing, start CPR: 30 chest compressions then 2 rescue breaths.', 'Keep them warm and on their side if they are breathing.'],
  'Hypothermia': ['Move to a dry, sheltered spot and remove wet clothes.', 'Wrap in dry blankets; warm the chest first, not the limbs.', 'Give warm, sweet drinks only if fully awake.'],
  'Cuts and wounds': ['Press a clean cloth on the wound for 10 minutes.', 'Rinse with clean (boiled or bottled) water.', 'Cover it and watch for infection. Flood water carries bacteria; get a tetanus shot if due.'],
  'Electric shock': ['Do not touch the person until power is switched off at the main.', 'Use a dry wooden stick to separate them from the source if needed.', 'Call 108; start CPR if there is no breathing.'],
  'Snake bite (common in floods)': ['Keep the person calm and still; keep the limb below heart level.', 'Do not cut, suck, or tie a tight band.', 'Get to a hospital for anti-venom at once.'],
  'Water-borne illness': ['Drink only boiled or chlorinated water.', 'For diarrhoea, give ORS and fluids.', 'Seek care for fever, blood in stool, or signs of leptospirosis (fever with muscle pain).']};
const PRECAUTIONS = {
  'Before a flood': ['Pack a go-bag: ID copies, medicines, phone power bank, torch, dry food, water.', 'Know your nearest relief camp and route.', 'Move valuables and documents to upper floors.', 'Keep this phone charged; SMS alerts are on.'],
  'During a flood': ['Move to higher ground early; do not wait for water to enter the house.', 'Never walk or drive through moving water. 15 cm can knock you down.', 'Switch off the mains power and gas.', 'Avoid boats without life jackets.'],
  'After a flood': ['Return only when authorities say it is safe.', 'Do not touch fallen power lines.', 'Throw away food that touched flood water.', 'Disinfect wells before drinking from them.']};
const SHELTERS = [ // [name, lat, lon]
  ['Alappuzha town relief camps', 9.4981, 76.3388], ['Vandanam medical college area', 9.4560, 76.3330], ['Cherthala town (high ground)', 9.6849, 76.3361]];
const ROUTES = [ // start → shelter index
  { name: 'Kuttanad (Kainakary) → Alappuzha town', from: [9.4300, 76.4150], to: 0, color: '#e4572e' },
  { name: 'Punnapra → Vandanam', from: [9.4350, 76.3300], to: 1, color: '#2e86ab' },
  { name: 'Pathirappally → Cherthala', from: [9.5400, 76.3600], to: 2, color: '#7b4fa3' }];
