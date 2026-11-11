import { store } from "./store";
import { evalioApi } from "./evalioApi";

// Bridge for existing REST service functions not migrated to RTK Query yet.
// Do not cache secrets or JWTs in Redux.
export function invalidateTeacherData() {
  store.dispatch(
    evalioApi.util.invalidateTags(["TeacherTests", "TeacherDashboard"]),
  );
}

export function invalidateTestPublication() {
  store.dispatch(
    evalioApi.util.invalidateTags([
      "TeacherTests",
      "TeacherDashboard",
      "Catalog",
      "StudentDashboard",
    ]),
  );
}

export function invalidateStudentProgress() {
  store.dispatch(
    evalioApi.util.invalidateTags([
      "StudentDashboard",
      "TeacherDashboard",
      "SubmissionHistory",
      "Catalog",
      "TeacherStatistics",
    ]),
  );
}
