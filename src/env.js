// Deployment environment marker (#95 stack split: prod / staging / sandbox).
//
// Overwritten per image at BUILD time from the Dockerfile `ARG MAPMAX_ENV` (so
// each container — web / web-staging / web-sandbox — knows which env it is).
// The committed default is production, which is also what GitHub Pages serves.
// Feature gating derives from this — deployment-driven, not URL-driven.
export const MAPMAX_ENV = 'prod';
