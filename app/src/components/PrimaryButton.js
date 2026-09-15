import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius } from '../theme';

export default function PrimaryButton({ label, onPress, disabled, tone = 'accent' }) {
  const bg = tone === 'danger' ? colors.badSolid : colors.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    marginTop: 18,
    paddingVertical: 13,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  label: { color: '#061024', fontWeight: '700', fontSize: 15 },
});
