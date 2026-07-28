import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import {
  dateStr,
  formatPlanDate,
  parseDate,
  todayStr,
} from '../lib/date';
import { useMenuDateCounts } from '../lib/queries';
import { radius, type as t, useTheme } from '../lib/theme';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function shiftMonth(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
}

function calendarDays(month: Date): Date[] {
  const first = startOfMonth(month);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function DateSelector({
  value,
  onChange,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDate(value)));
  const minimumDate = todayStr();
  const minimumMonth = startOfMonth(parseDate(minimumDate));

  useEffect(() => {
    if (open) setVisibleMonth(startOfMonth(parseDate(value)));
  }, [open, value]);

  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);
  const rangeStart = dateStr(days[0]);
  const rangeEnd = dateStr(days[days.length - 1]);
  const { data: menuDateCounts } = useMenuDateCounts(rangeStart, rangeEnd, open);
  const menuCountByDate = useMemo(
    () => new Map((menuDateCounts ?? []).map((item) => [item.date, item.count])),
    [menuDateCounts],
  );
  const canGoPrevious = visibleMonth.getTime() > minimumMonth.getTime();
  const quickDates = [
    { label: '今天', value: todayStr() },
    { label: '明天', value: todayStr(1) },
  ];

  return (
    <>
      <View style={[styles.selector, style]}>
        {quickDates.map((quick) => {
          const selected = value === quick.value;
          return (
            <Pressable
              key={quick.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(quick.value)}
              style={({ pressed }) => [
                styles.quickButton,
                {
                  backgroundColor: selected ? c.tint : pressed ? c.fill : c.card,
                  borderColor: selected ? c.tint : c.separator,
                },
              ]}
            >
              <Text
                style={[
                  t.footnote,
                  { color: selected ? '#FFFFFF' : c.label, fontWeight: '700' },
                ]}
              >
                {quick.label}
              </Text>
            </Pressable>
          );
        })}

        <Pressable
          accessibilityLabel={`打开日期选择，当前${formatPlanDate(value)}`}
          accessibilityRole="button"
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.calendarButton,
            {
              backgroundColor: pressed ? c.fill : c.card,
              borderColor: c.separator,
            },
          ]}
        >
          <CalendarDays color={c.tint} size={17} />
          <Text style={[t.footnote, { color: c.label, fontWeight: '700' }]}>
            {formatPlanDate(value)}
          </Text>
        </Pressable>
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel="关闭日期选择"
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />

          <View
            accessibilityViewIsModal
            style={[
              styles.calendar,
              { backgroundColor: c.card, borderColor: c.separator },
            ]}
          >
            <View style={styles.calendarHeader}>
              <Pressable
                accessibilityLabel="上个月"
                accessibilityRole="button"
                accessibilityState={{ disabled: !canGoPrevious }}
                disabled={!canGoPrevious}
                onPress={() => setVisibleMonth((current) => shiftMonth(current, -1))}
                style={({ pressed }) => [
                  styles.iconButton,
                  { backgroundColor: pressed ? c.fill : 'transparent' },
                ]}
              >
                <ChevronLeft
                  color={canGoPrevious ? c.label : c.tertiaryLabel}
                  size={20}
                />
              </Pressable>

              <Text style={[t.headline, { color: c.label }]}>
                {visibleMonth.getFullYear()}年 {visibleMonth.getMonth() + 1}月
              </Text>

              <View style={styles.headerActions}>
                <Pressable
                  accessibilityLabel="下个月"
                  accessibilityRole="button"
                  onPress={() => setVisibleMonth((current) => shiftMonth(current, 1))}
                  style={({ pressed }) => [
                    styles.iconButton,
                    { backgroundColor: pressed ? c.fill : 'transparent' },
                  ]}
                >
                  <ChevronRight color={c.label} size={20} />
                </Pressable>
                <Pressable
                  accessibilityLabel="关闭"
                  accessibilityRole="button"
                  onPress={() => setOpen(false)}
                  style={({ pressed }) => [
                    styles.iconButton,
                    { backgroundColor: pressed ? c.fill : 'transparent' },
                  ]}
                >
                  <X color={c.secondaryLabel} size={19} />
                </Pressable>
              </View>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAYS.map((weekday, index) => (
                <Text
                  key={weekday}
                  style={[
                    styles.weekday,
                    t.caption,
                    { color: index > 4 ? c.orange : c.secondaryLabel },
                  ]}
                >
                  {weekday}
                </Text>
              ))}
            </View>

            <View style={styles.daysGrid}>
              {days.map((day) => {
                const dayValue = dateStr(day);
                const selected = dayValue === value;
                const isToday = dayValue === minimumDate;
                const disabled = dayValue < minimumDate;
                const outside = day.getMonth() !== visibleMonth.getMonth();
                const weekend = day.getDay() === 0 || day.getDay() === 6;
                const menuCount = menuCountByDate.get(dayValue) ?? 0;

                return (
                  <View key={dayValue} style={styles.dayCell}>
                    <Pressable
                      accessibilityLabel={`选择${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日${menuCount ? `，已有${menuCount}道菜` : ''}`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled, selected }}
                      disabled={disabled}
                      onPress={() => {
                        onChange(dayValue);
                        setOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.dayButton,
                        isToday && !selected && { borderColor: c.tint, borderWidth: 1 },
                        selected && { backgroundColor: c.tint },
                        pressed && !selected && { backgroundColor: c.fill },
                      ]}
                    >
                      <Text
                        style={[
                          t.subhead,
                          {
                            color: selected
                              ? '#FFFFFF'
                              : disabled || outside
                                ? c.tertiaryLabel
                                : weekend
                                  ? c.orange
                                  : c.label,
                            fontWeight: selected || isToday ? '700' : '400',
                          },
                        ]}
                      >
                        {day.getDate()}
                      </Text>
                      {menuCount ? (
                        <View
                          style={[
                            styles.menuBadge,
                            {
                              backgroundColor: selected ? '#FFFFFF' : c.orange,
                              borderColor: c.card,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.menuBadgeText,
                              { color: selected ? c.tint : '#FFFFFF' },
                            ]}
                          >
                            {menuCount > 9 ? '9+' : menuCount}
                          </Text>
                        </View>
                      ) : null}
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  selector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  quickButton: {
    height: 40,
    minWidth: 60,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarButton: {
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 25, 20, 0.38)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  calendar: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 14,
  },
  calendarHeader: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekRow: { flexDirection: 'row', marginTop: 12, marginBottom: 4 },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontWeight: '600' },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%`,
    height: 43,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBadge: {
    position: 'absolute',
    right: -3,
    bottom: -2,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1.5,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBadgeText: { fontSize: 8, lineHeight: 10, fontWeight: '800' },
});
