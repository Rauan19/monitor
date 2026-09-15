import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, DarkTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { colors } from './src/theme';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { registerForPushNotifications } from './src/notifications';
import DrawerContent from './src/components/DrawerContent';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import ClientsScreen from './src/screens/ClientsScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import SystemScreen from './src/screens/SystemScreen';
import StatsScreen from './src/screens/StatsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ClientDetailScreen from './src/screens/ClientDetailScreen';
import OltsScreen from './src/screens/OltsScreen';

const TAB_BAR_HEIGHT = 64; // sem contar o inset da barra do sistema

const ABA_OCULTA = { tabBarItemStyle: { display: 'none' } };

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const Drawer = createDrawerNavigator();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.ink,
    border: colors.line,
    primary: colors.accent,
  },
};

const TAB_ICONS = {
  Início: 'home-outline',
  Clientes: 'people-outline',
  Histórico: 'time-outline',
  Alertas: 'notifications-outline',
  Sistema: 'hardware-chip-outline',
  Estatísticas: 'stats-chart-outline',
  Ajustes: 'settings-outline',
};

const TAB_ICONS_FOCUSED = {
  Início: 'home',
  Clientes: 'people',
  Histórico: 'time',
  Alertas: 'notifications',
  Sistema: 'hardware-chip',
  Estatísticas: 'stats-chart',
  Ajustes: 'settings',
};

function HeaderMenuButton({ navigation }) {
  return (
    <Pressable
      onPress={() => navigation.openDrawer()}
      hitSlop={10}
      style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
    >
      <Ionicons name="menu-outline" size={26} color={colors.ink} />
    </Pressable>
  );
}

function HeaderBackButton({ navigation }) {
  return (
    <Pressable
      onPress={() => navigation.goBack()}
      hitSlop={10}
      style={({ pressed }) => [styles.headerBtn, styles.headerBackBtn, pressed && styles.headerBtnPressed]}
    >
      <Ionicons name="chevron-back" size={24} color={colors.ink} />
      <Text style={styles.headerBackLabel}>Voltar</Text>
    </Pressable>
  );
}

function MainTabs() {
  // Edge-to-edge e obrigatorio desde o SDK 55: o app desenha por baixo da barra
  // de navegacao do sistema. Em aparelho com botoes na tela isso engoliria a
  // barra de abas. O React Navigation somaria o inset sozinho, mas nao quando
  // tabBarStyle define `height` (BottomTabBar getTabBarHeight retorna antes) nem
  // quando define `paddingBottom` (o tabBarStyle e espalhado por ultimo e
  // sobrescreve). Como queremos a barra mais alta que o padrao, somamos aqui.
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route, navigation }) => ({
        headerStyle: styles.header,
        headerTitleStyle: styles.headerTitle,
        headerShadowVisible: false,
        headerLeft: () => <HeaderMenuButton navigation={navigation} />,
        tabBarStyle: [
          styles.tabBar,
          { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: 8 + insets.bottom },
        ],
        tabBarItemStyle: styles.tabBarItem,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarIcon: ({ focused, color }) => (
          <Ionicons
            name={focused ? TAB_ICONS_FOCUSED[route.name] : TAB_ICONS[route.name]}
            size={22}
            color={color}
          />
        ),
        tabBarLabel: ({ focused, color }) => (
          <TabLabel color={color} label={route.name} focused={focused} />
        ),
      })}
    >
      <Tab.Screen name="Início" component={HomeScreen} />
      <Tab.Screen name="Clientes" component={ClientsScreen} />
      <Tab.Screen name="Histórico" component={HistoryScreen} />
      <Tab.Screen name="Alertas" component={NotificationsScreen} />
      <Tab.Screen name="Sistema" component={SystemScreen} />
      {/* Fora da barra de abas: 7 itens em ~375px dariam 53px cada e "Estatísticas"
          nao caberia. Continuam alcancaveis pelo menu lateral, que lista todas. */}
      <Tab.Screen name="Estatísticas" component={StatsScreen} options={ABA_OCULTA} />
      <Tab.Screen name="Ajustes" component={SettingsScreen} options={ABA_OCULTA} />
    </Tab.Navigator>
  );
}

function TabLabel({ color, label, focused }) {
  return (
    <View style={styles.tabLabelWrap}>
      <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
      {focused && <View style={styles.tabDot} />}
    </View>
  );
}

function DrawerNavigator() {
  return (
    <Drawer.Navigator
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerStyle: { width: 288, backgroundColor: colors.surface },
        overlayColor: 'rgba(0,0,0,0.55)',
        swipeEdgeWidth: 60,
      }}
      drawerContent={(props) => <DrawerContent {...props} />}
    >
      <Drawer.Screen name="Tabs" component={MainTabs} />
    </Drawer.Navigator>
  );
}

function RootNavigator() {
  const { checking, user } = useAuth();
  const registeredFor = useRef(null);
  const navigationRef = useNavigationContainerRef();
  const [navReady, setNavReady] = useState(false);
  // useLastNotificationResponse (em vez de addNotificationResponseReceivedListener)
  // porque ele também entrega o toque que ABRIU o app do zero. Com o listener
  // puro, notificação tocada com o app fechado não levava a lugar nenhum.
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledNotification = useRef(null);

  useEffect(() => {
    if (user && registeredFor.current !== user) {
      registeredFor.current = user;
      registerForPushNotifications();
    }
  }, [user]);

  useEffect(() => {
    if (!lastResponse || !user || !navReady) return;
    // Só o toque no corpo da notificação navega (não botões de ação).
    if (lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

    const id = lastResponse.notification.request.identifier;
    if (handledNotification.current === id) return;
    if (!navigationRef.isReady()) return;
    handledNotification.current = id;

    // Todo alerta de push (queda em massa, CCR fora do ar, teste) mora na aba
    // Alertas, que mostra a porta/região e quais clientes caíram.
    navigationRef.navigate('Main', { screen: 'Tabs', params: { screen: 'Alertas' } });
  }, [lastResponse, user, navReady, navigationRef]);

  if (checking) return null;

  return (
    <NavigationContainer ref={navigationRef} onReady={() => setNavReady(true)} theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerStyle: styles.header, headerTintColor: colors.ink, headerShadowVisible: false }}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Main" component={DrawerNavigator} options={{ headerShown: false }} />
            <Stack.Screen
              name="ClientDetail"
              component={ClientDetailScreen}
              options={({ navigation }) => ({
                title: 'Cliente',
                headerTitleStyle: styles.headerTitle,
                headerLeft: () => <HeaderBackButton navigation={navigation} />,
              })}
            />
            <Stack.Screen
              name="Olts"
              component={OltsScreen}
              options={({ navigation }) => ({
                title: 'OLTs e portas',
                headerTitleStyle: styles.headerTitle,
                headerLeft: () => <HeaderBackButton navigation={navigation} />,
              })}
            />
          </>
        )}
      </Stack.Navigator>
      <StatusBar style="light" />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surface, elevation: 0, shadowOpacity: 0 },
  headerTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  headerBtn: { paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' },
  headerBtnPressed: { opacity: 0.5 },
  headerBackBtn: { paddingLeft: Platform.OS === 'ios' ? 4 : 8 },
  headerBackLabel: { color: colors.ink, fontSize: 16, fontWeight: '600', marginLeft: 2 },
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    paddingTop: 8,
  },
  tabBarItem: { paddingTop: 2 },
  tabLabelWrap: { alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 56 },
  tabLabel: { fontSize: 10.5, fontWeight: '700' },
  tabDot: { position: 'absolute', top: -10, width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent },
});
