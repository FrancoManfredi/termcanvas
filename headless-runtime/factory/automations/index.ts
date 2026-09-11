/**
 * automations/index — Wave 14 T02 (Track A): public re-exports.
 *
 * Single entry point for the automations domain. Track B (T04) imports the
 * routes and service helpers from here; nobody reaches past this barrel.
 * ESM only, zero require().
 */

export * from "./automationTypes";
export * from "./automationStore";
export * from "./triggerEngine";
export * from "./automationService";
export * from "./automationRoutes";
