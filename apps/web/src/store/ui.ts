import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface ExpenseDialogState {
  open: boolean;
  /** Preselected group (required for edit/duplicate). */
  groupId?: string;
  /** Edit this expense. */
  expenseId?: string;
  /** Prefill from this expense as a new one (duplicate). */
  duplicateOfId?: string;
  /** Preselected plan link. */
  planId?: string;
}

export interface SettleDialogState {
  open: boolean;
  groupId?: string;
  fromMemberId?: string;
  toMemberId?: string;
  amountMinor?: number;
}

export interface Toast {
  id: number;
  message: string;
  severity: 'success' | 'error' | 'info' | 'warning';
}

interface UiState {
  sidebarCollapsed: boolean;
  searchOpen: boolean;
  expenseDialog: ExpenseDialogState;
  settleDialog: SettleDialogState;
  createGroupOpen: boolean;
  toast: Toast | null;
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('ss.sidebarCollapsed') === '1';
  } catch {
    return false;
  }
}

const initialState: UiState = {
  sidebarCollapsed: readCollapsed(),
  searchOpen: false,
  expenseDialog: { open: false },
  settleDialog: { open: false },
  createGroupOpen: false,
  toast: null,
};

let toastId = 0;

const ui = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      try {
        localStorage.setItem('ss.sidebarCollapsed', state.sidebarCollapsed ? '1' : '0');
      } catch {
        /* storage unavailable: the preference simply is not remembered */
      }
    },
    setSearchOpen(state, action: PayloadAction<boolean>) {
      state.searchOpen = action.payload;
    },
    openExpenseDialog(state, action: PayloadAction<Omit<ExpenseDialogState, 'open'> | undefined>) {
      state.expenseDialog = { open: true, ...(action.payload ?? {}) };
    },
    closeExpenseDialog(state) {
      state.expenseDialog = { open: false };
    },
    openSettleDialog(state, action: PayloadAction<Omit<SettleDialogState, 'open'>>) {
      state.settleDialog = { open: true, ...action.payload };
    },
    closeSettleDialog(state) {
      state.settleDialog = { open: false };
    },
    setCreateGroupOpen(state, action: PayloadAction<boolean>) {
      state.createGroupOpen = action.payload;
    },
    showToast(state, action: PayloadAction<{ message: string; severity?: Toast['severity'] }>) {
      state.toast = { id: ++toastId, message: action.payload.message, severity: action.payload.severity ?? 'success' };
    },
    clearToast(state) {
      state.toast = null;
    },
  },
});

export const {
  toggleSidebar,
  setSearchOpen,
  openExpenseDialog,
  closeExpenseDialog,
  openSettleDialog,
  closeSettleDialog,
  setCreateGroupOpen,
  showToast,
  clearToast,
} = ui.actions;
export const uiReducer = ui.reducer;
