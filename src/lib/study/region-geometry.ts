import type { QuestionRegion } from "./contracts";
/** Strip editor-only identifiers before persisting a moved/resized region. */
export function regionCoordinates(region: QuestionRegion): QuestionRegion {
  return { page: region.page, role: region.role, x: region.x, y: region.y, width: region.width, height: region.height };
}
