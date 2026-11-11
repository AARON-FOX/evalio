import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { evalioApi } from "./evalioApi";
import dashboardFiltersReducer from "./dashboardFiltersSlice";

export const store = configureStore({
  reducer: {
    dashboardFilters: dashboardFiltersReducer,
    [evalioApi.reducerPath]: evalioApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(evalioApi.middleware),
});

setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
