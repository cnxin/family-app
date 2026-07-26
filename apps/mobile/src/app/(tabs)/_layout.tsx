import { Redirect, Tabs } from 'expo-router';
import { SymbolView, SFSymbol } from 'expo-symbols';
import React from 'react';
import { ColorValue, Platform, Text } from 'react-native';
import { useSession } from '../../lib/session';
import { useTheme } from '../../lib/theme';

function TabIcon({
  sf,
  emoji,
  color,
}: {
  sf: SFSymbol;
  emoji: string;
  color: ColorValue;
}) {
  if (Platform.OS === 'ios') {
    return <SymbolView name={sf} size={26} tintColor={color} />;
  }
  return <Text style={{ fontSize: 22 }}>{emoji}</Text>;
}

export default function TabLayout() {
  const c = useTheme();
  const { member, ready } = useSession();

  if (ready && !member) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.tint,
        tabBarInactiveTintColor: c.secondaryLabel,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.separator },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '点菜',
          tabBarIcon: ({ color }) => (
            <TabIcon sf="fork.knife" emoji="🍽️" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="kitchen"
        options={{
          title: '今日菜单',
          tabBarIcon: ({ color }) => (
            <TabIcon sf="frying.pan" emoji="🍳" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="shopping"
        options={{
          title: '购物清单',
          tabBarIcon: ({ color }) => (
            <TabIcon sf="cart" emoji="🛒" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ color }) => (
            <TabIcon sf="person.crop.circle" emoji="👤" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
