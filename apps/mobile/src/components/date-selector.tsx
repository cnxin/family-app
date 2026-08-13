import { CalendarDays } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import {
  CalendarMonth,
  calendarRange,
  startOfMonth,
} from './calendar-month';
import { formatPlanDate, parseDate, todayStr } from '../lib/date';
import { useCalendarEntries } from '../lib/queries';
import { radius, type as t, useTheme } from '../lib/theme';
import { AdaptiveDialog } from './ui';

export function DateSelector({
  allowPast = false,
  value,
  onChange,
  style,
}: {
  allowPast?: boolean;
  value: string;
  onChange: (value: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(parseDate(value)),
  );
  const range = calendarRange(visibleMonth);
  const { data: entries } = useCalendarEntries(range.start, range.end, open);

  useEffect(() => {
    if (open) setVisibleMonth(startOfMonth(parseDate(value)));
  }, [open, value]);

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

      <AdaptiveDialog
        accessibilityLabel="日期选择"
        maxWidth={388}
        onClose={() => setOpen(false)}
        style={styles.calendarDialog}
        testID="date-selector-dialog"
        visible={open}
      >
        <View style={styles.calendar}>
          <CalendarMonth
            entries={entries}
            minimumDate={allowPast ? undefined : todayStr()}
            onClose={() => setOpen(false)}
            onMonthChange={setVisibleMonth}
            onSelect={(date) => {
              onChange(date);
              setOpen(false);
            }}
            selectedDate={value}
            visibleMonth={visibleMonth}
          />
        </View>
      </AdaptiveDialog>
    </>
  );
}

const styles = StyleSheet.create({
  selector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
  },
  quickButton: {
    height: 40,
    minWidth: 54,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarButton: {
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  calendarDialog: { maxHeight: 560 },
  calendar: {
    paddingHorizontal: 4,
    paddingVertical: 14,
  },
});
