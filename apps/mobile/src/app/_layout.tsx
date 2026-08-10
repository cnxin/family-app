import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { CartProvider } from '../lib/cart';
import { SessionProvider } from '../lib/session';
import { useTheme } from '../lib/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RootStack() {
  const c = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="guest/[token]" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="dish/[id]"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.7, 1],
          sheetGrabberVisible: true,
          sheetCornerRadius: 24,
        }}
      />
      <Stack.Screen
        name="asset/[id]"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.7, 1],
          sheetGrabberVisible: true,
          sheetCornerRadius: 24,
        }}
      />
      <Stack.Screen name="dish-edit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="recipe-edit" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <CartProvider>
            <StatusBar style="auto" />
            <RootStack />
          </CartProvider>
        </SessionProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
