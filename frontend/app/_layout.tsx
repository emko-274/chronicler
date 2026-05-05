import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IoniconName) {
  return ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} size={size} color={color} />
  );
}

export default function Layout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#6366f1' }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: tabIcon('home-outline'),
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: 'Log Activity',
          tabBarIcon: tabIcon('add-circle-outline'),
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: 'Insights',
          tabBarIcon: tabIcon('analytics-outline'),
        }}
      />
      <Tabs.Screen
        name="manage"
        options={{
          title: 'Manage',
          tabBarIcon: tabIcon('pricetag-outline'),
        }}
      />
      <Tabs.Screen
        name="export"
        options={{
          title: 'Export',
          tabBarIcon: tabIcon('download-outline'),
        }}
      />
    </Tabs>
  );
}
