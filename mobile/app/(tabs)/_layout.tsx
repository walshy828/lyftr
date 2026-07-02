import { Tabs } from 'expo-router'
import { House, ChartLine, Settings } from 'lucide-react-native'

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#00b8d9',
        tabBarInactiveTintColor: '#475569',
        tabBarStyle: {
          backgroundColor: '#0d1629',
          borderTopColor: '#1c2f50',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="weight"
        options={{ title: 'Weight', tabBarIcon: ({ color, size }) => <ChartLine color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Settings color={color} size={size} /> }}
      />
    </Tabs>
  )
}
