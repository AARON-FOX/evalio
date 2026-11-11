import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DashboardStatus } from "../services/dashboardApi";

interface DashboardFiltersState {
  page: number;
  status: DashboardStatus;
  search: string;
}

const initialState: DashboardFiltersState = {
  page: 1,
  status: "all",
  search: "",
};

const slice = createSlice({
  name: "dashboardFilters",
  initialState,
  reducers: {
    setDashboardPage(state, action: PayloadAction<number>) {
      state.page = Math.max(1, action.payload);
    },
    setDashboardStatus(state, action: PayloadAction<DashboardStatus>) {
      state.status = action.payload;
      state.page = 1;
    },
    setDashboardSearch(state, action: PayloadAction<string>) {
      state.search = action.payload;
      state.page = 1;
    },
    resetDashboardFilters: () => initialState,
  },
});

export const {
  setDashboardPage,
  setDashboardStatus,
  setDashboardSearch,
  resetDashboardFilters,
} = slice.actions;
export default slice.reducer;
