import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { api } from '../api/api';
import { uiReducer } from './ui';

export function makeStore() {
  return configureStore({
    reducer: { [api.reducerPath]: api.reducer, ui: uiReducer },
    middleware: (getDefault) => getDefault().concat(api.middleware),
  });
}

export const store = makeStore();
export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
