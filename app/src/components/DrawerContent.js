import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { DrawerContentScrollView } from '@react-navigation/drawer';
import { colors, radius } from '../theme';
import { useAuth } from '../context/AuthContext';

const MENU_ITEMS = [
  { name: 'Início', icon: 'home-outline', iconActive: 'home' },
  { name: 'Clientes', icon: 'people-outline', iconActive: 'people' },
  { name: 'Histórico', icon: 'time-outline', iconActive: 'time' },
  { name: 'Alertas', icon: 'notifications-outline', iconActive: 'notifications' },
  { name: 'Mapa', icon: 'map-outline', iconActive: 'map' },
  { name: 'Links', icon: 'git-network-outline', iconActive: 'git-network' },
  { name: 'Sistema', icon: 'hardware-chip-outline', iconActive: 'hardware-chip' },
  { name: 'Estatísticas', icon: 'stats-chart-outline', iconActive: 'stats-chart' },
  { name: 'Ajustes', icon: 'settings-outline', iconActive: 'settings' },
];

export default function DrawerContent(props) {
  const { state, navigation } = props;
  const { user, logout } = useAuth();

  const tabsRoute = state.routes.find((r) => r.name === 'Tabs');
  const tabsState = tabsRoute?.state;
  const activeTab = tabsState ? tabsState.routeNames[tabsState.index] : MENU_ITEMS[0].name;

  const handleLogout = () => {
    Alert.alert('Sair', 'Deseja sair da sua conta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <DrawerContentScrollView {...props} contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user || '?').slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.appName}>MonitorZcnet</Text>
            <Text style={styles.userName} numberOfLines={1}>{user || 'visitante'}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.menu}>
          {MENU_ITEMS.map(({ name, icon, iconActive }) => {
            const active = name === activeTab;
            return (
              <Pressable
                key={name}
                onPress={() => navigation.navigate('Tabs', { screen: name })}
                style={({ pressed }) => [
                  styles.item,
                  active && styles.itemActive,
                  pressed && !active && styles.itemPressed,
                ]}
              >
                <Ionicons
                  name={active ? iconActive : icon}
                  size={20}
                  color={active ? colors.accent : colors.inkSoft}
                  style={styles.itemIcon}
                />
                <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{name}</Text>
                {active && <View style={styles.itemDot} />}
              </Pressable>
            );
          })}
        </View>
      </DrawerContentScrollView>

      <View style={styles.footer}>
        <View style={styles.divider} />
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [styles.logoutBtn, pressed && styles.itemPressed]}
        >
          <Ionicons name="log-out-outline" size={20} color={colors.bad} style={styles.itemIcon} />
          <Text style={styles.logoutLabel}>Sair</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingTop: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 18,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },
  avatarText: { color: colors.accent, fontSize: 18, fontWeight: '800' },
  headerText: { flex: 1 },
  appName: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  userName: { color: colors.inkFaint, fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.line, marginHorizontal: 14 },
  menu: { paddingTop: 10, paddingHorizontal: 10, gap: 3 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: radius.sm,
  },
  itemPressed: { backgroundColor: colors.surface2 },
  itemActive: { backgroundColor: colors.accentBg },
  itemIcon: { width: 22, textAlign: 'center' },
  itemLabel: { color: colors.inkSoft, fontSize: 14, fontWeight: '600', flex: 1 },
  itemLabelActive: { color: colors.accent, fontWeight: '800' },
  itemDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  footer: { paddingBottom: 8 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  logoutLabel: { color: colors.bad, fontSize: 14, fontWeight: '700' },
});
