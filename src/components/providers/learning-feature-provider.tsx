"use client";

import { createContext, useContext, type ReactNode } from "react";

interface LearningFeatureContextValue {
  navigationVisible: boolean;
}

const LearningFeatureContext = createContext<LearningFeatureContextValue>({
  navigationVisible: false,
});

export function LearningFeatureProvider({
  children,
  navigationVisible,
}: {
  children: ReactNode;
  navigationVisible: boolean;
}) {
  return (
    <LearningFeatureContext.Provider value={{ navigationVisible }}>
      {children}
    </LearningFeatureContext.Provider>
  );
}

export function useLearningFeatureVisibility(): boolean {
  return useContext(LearningFeatureContext).navigationVisible;
}
