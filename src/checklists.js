// PV sampling / IPC checklists, one default list per process step. A step's
// list is copied onto the task (work_tasks.checklist) the first time you tick
// something, so editing these defaults never rewrites a lot already in progress.
// Edit the lists here to match the protocol.
export const CHECKLISTS = {
  Mix: ['Blend time & speed recorded', 'Blend uniformity samples (10 locations)', 'LOD / moisture', 'Bulk & tapped density', 'Sieve analysis'],
  Tab: ['Set-up approved (weight, hardness, thickness)', 'Weight variation — start / middle / end', 'Hardness & thickness', 'Friability', 'Disintegration', 'Content uniformity samples (stratified)'],
  Capsule: ['Fill weight variation — start / middle / end', 'Lock length & appearance', 'Disintegration', 'Content uniformity samples (stratified)'],
  Coat: ['Spray rate, inlet & bed temperature recorded', 'Weight gain %', 'Appearance (no picking, twinning)', 'Disintegration — coated'],
  Powder: ['Fill weight variation', 'LOD / moisture', 'Content uniformity samples'],
  'Fill Cream': ['Fill weight — start / middle / end', 'Appearance & homogeneity', 'pH', 'Viscosity', 'Assay samples — start / middle / end'],
  'Fill Liquid': ['Fill volume — start / middle / end', 'Appearance & clarity', 'pH', 'Viscosity / density', 'Assay samples — start / middle / end'],
  Bottle: ['Cap torque', 'Leak test', 'Batch coding & label check', 'Reconciliation'],
  Strip: ['Seal integrity / leak test', 'Batch coding & print check', 'Reconciliation'],
  Blister: ['Leak test (blue dye)', 'Forming & sealing temperature recorded', 'Batch coding & print check', 'Reconciliation'],
  Packing: ['Carton & leaflet check', 'Batch coding check', 'Final reconciliation', 'Retention samples taken'],
}

// Items for a task: its saved list, else the step's default (not yet started).
export function checklistFor(t) {
  if (t?.type !== 'pv_lot') return null
  if (Array.isArray(t.checklist) && t.checklist.length) return t.checklist
  const def = CHECKLISTS[t.step]
  return def ? def.map(text => ({ t: text, done: false })) : null
}

export function checklistProgress(t) {
  const items = checklistFor(t)
  if (!items) return null
  return { done: items.filter(i => i.done).length, total: items.length, started: Array.isArray(t.checklist) && t.checklist.some(i => i.done) }
}
