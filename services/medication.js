const medicationPlan = require('./medication-plan')
const medicationConfirm = require('./medication-confirm')
const medicationMerge = require('./medication-merge')

module.exports = {
  appendMedicationConfirmation: medicationConfirm.appendMedicationConfirmation,
  buildWeeklyMedicationOverview: medicationMerge.buildWeeklyMedicationOverview,
  confirmMedication: medicationConfirm.confirmMedication,
  confirmMedicationLocal: medicationConfirm.confirmMedicationLocal,
  deleteMedicationPlan: medicationPlan.deleteMedicationPlan,
  deleteMedicationPlanLocal: medicationPlan.deleteMedicationPlanLocal,
  findNextPendingTime: medicationMerge.findNextPendingTime,
  getMedConfirmData: medicationMerge.getMedConfirmData,
  getMedEditData: medicationPlan.getMedEditData,
  getMedHistoryData: medicationConfirm.getMedHistoryData,
  getMedListData: medicationMerge.getMedListData,
  getStoredMedicationConfirmations: medicationConfirm.getStoredMedicationConfirmations,
  getStoredMedicationPlans: medicationPlan.getStoredMedicationPlans,
  mapMedicationPlanToListItem: medicationPlan.mapMedicationPlanToListItem,
  mergeConfirmationsByLogId: medicationConfirm.mergeConfirmationsByLogId,
  mergeHomeFamilyMedicationStatus: medicationMerge.mergeHomeFamilyMedicationStatus,
  mergeHomeMedicationStatus: medicationMerge.mergeHomeMedicationStatus,
  mergeListByTimestamp: medicationMerge.mergeListByTimestamp,
  mergeReminderMedicationStatus: medicationMerge.mergeReminderMedicationStatus,
  parseMedTaskId: medicationMerge.parseMedTaskId,
  revokeMedicationConfirmation: medicationConfirm.revokeMedicationConfirmation,
  revokeMedicationConfirmationLocal: medicationConfirm.revokeMedicationConfirmationLocal,
  saveMedicationPlan: medicationPlan.saveMedicationPlan,
  saveMedicationPlanLocal: medicationPlan.saveMedicationPlanLocal,
  toggleMedicationPlanStatus: medicationPlan.toggleMedicationPlanStatus,
  toggleMedicationPlanStatusLocal: medicationPlan.toggleMedicationPlanStatusLocal,
  upsertMedicationPlan: medicationPlan.upsertMedicationPlan
}
