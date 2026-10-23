import { addDays, householdToday } from '@family/shared';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { decryptIntegrationCredential } from '../common/integration-credentials';
import {
  Guest,
  GuestInvitation,
  GuestMealRequest,
  GuestWifiProfile,
  GuestWifiSecurity,
  MealType,
  Poll,
  Visit,
  VisitGuest,
} from '../entities';

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function date(value: string, field: string) {
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) throw new BadRequestException(`${field}无效`);
  return result;
}

export function validRange(startsAt: Date, endsAt: Date | null) {
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new BadRequestException('结束时间必须晚于开始时间');
  }
}

export function dateOnly(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field}必须为日期`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field}无效`);
  }
  return value;
}

export function visitMealDates(visit: Visit) {
  const timezone = visit.household.timezone;
  const start = householdToday(timezone, visit.startsAt);
  const end = householdToday(timezone, visit.endsAt ?? visit.startsAt);
  const dates: string[] = [];
  for (let current = start; current <= end; current = addDays(current, 1)) {
    dates.push(current);
  }
  return dates;
}

export function profileGuest(guest: Guest) {
  return {
    id: guest.id,
    name: guest.name,
    avatarEmoji: guest.avatarEmoji,
    note: guest.note,
    isActive: guest.isActive,
    anonymizedAt: guest.anonymizedAt,
    createdAt: guest.createdAt,
    updatedAt: guest.updatedAt,
  };
}

export function invitationProfile(invitation: GuestInvitation) {
  return {
    id: invitation.id,
    guestId: invitation.guestId,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    allowsMovieVoting: invitation.allowsMovieVoting,
    allowsMealRequests: invitation.allowsMealRequests,
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
  };
}

export function profileGuestWifi(profile: GuestWifiProfile) {
  return {
    id: profile.id,
    name: profile.name,
    ssid: profile.ssid,
    security: profile.security,
    passwordConfigured: profile.security === 'WPA' && profile.passwordEncrypted !== null,
    isActive: profile.isActive,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function profileGuestMealRequest(request: GuestMealRequest) {
  return {
    id: request.id,
    menuItemId: request.menuItemId,
    mealDate: request.mealDate,
    mealType: request.mealType,
    dishName: request.dishName,
    note: request.note,
    status: request.status,
    reviewNote: request.reviewNote,
    reviewedAt: request.reviewedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export function profileVisit(visit: Visit, invitations: GuestInvitation[], mealRequests: GuestMealRequest[]) {
  const invitationsByGuest = new Map(invitations.map((entry) => [entry.guestId, entry]));
  return {
    id: visit.id,
    title: visit.title,
    startsAt: visit.startsAt,
    endsAt: visit.endsAt,
    note: visit.note,
    status: visit.status,
    guestWifiProfile: visit.guestWifiProfile ? profileGuestWifi(visit.guestWifiProfile) : null,
    hostMember: visit.hostMember
      ? {
          id: visit.hostMember.id,
          name: visit.hostMember.name,
          avatarEmoji: visit.hostMember.avatarEmoji,
        }
      : null,
    guests: (visit.guests ?? []).map((entry) => ({
      id: entry.id,
      guest: profileGuest(entry.guest),
      isAttending: entry.isAttending,
      respondedAt: entry.respondedAt,
      invitation: invitationsByGuest.has(entry.guestId)
        ? invitationProfile(invitationsByGuest.get(entry.guestId)!)
        : null,
    })),
    mealRequests: mealRequests.map((request) => ({
      ...profileGuestMealRequest(request),
      guest: request.invitation?.guest ? profileGuest(request.invitation.guest) : null,
    })),
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt,
  };
}

export function publicProfile(invitation: GuestInvitation, participant?: VisitGuest | null) {
  const guestWifiProfile = invitation.visit.guestWifiProfile;
  const wifi = guestWifiProfile?.isActive
    ? publicWifiProfile(guestWifiProfile, invitation.visit.householdId)
    : null;
  return {
    guest: { name: invitation.guest.name, avatarEmoji: invitation.guest.avatarEmoji },
    householdName: invitation.visit.household.name,
    visit: {
      title: invitation.visit.title,
      startsAt: invitation.visit.startsAt,
      endsAt: invitation.visit.endsAt,
      note: invitation.visit.note,
    },
    response: {
      attending: participant?.isAttending ?? null,
      respondedAt: participant?.respondedAt ?? null,
    },
    capabilities: { movieVoting: invitation.allowsMovieVoting, mealRequests: invitation.allowsMealRequests },
    mealRequestDates: invitation.allowsMealRequests ? visitMealDates(invitation.visit) : [],
    wifi,
    expiresAt: invitation.expiresAt,
  };
}

function publicWifiProfile(profile: GuestWifiProfile, householdId: string) {
  try {
    const password = profile.security === 'WPA'
      ? decryptIntegrationCredential(profile.passwordEncrypted, householdId, 'guest-wifi', '访客 Wi-Fi')
      : null;
    if (profile.security === 'WPA' && !password) return null;
    // Wi-Fi 二维码（WIFI:T:…;S:…;P:…;;）里的 \ ; , : " 用一个反斜杠转义；原来写成了两个，带这些字符的 SSID / 密码扫出来连不上
    const escape = (value: string) => value.replace(/([\\;,:"])/g, '\\$1');
    const qrPayload = profile.security === 'WPA'
      ? `WIFI:T:WPA;S:${escape(profile.ssid)};P:${escape(password!)};;`
      : `WIFI:T:nopass;S:${escape(profile.ssid)};;`;
    return { ssid: profile.ssid, security: profile.security, qrPayload };
  } catch {
    return null;
  }
}

export function assertMovieVotingAllowed(invitation: GuestInvitation) {
  if (!invitation.allowsMovieVoting) {
    throw new NotFoundException('此邀请未开放观影投票');
  }
}

export function assertMealRequestsAllowed(invitation: GuestInvitation) {
  if (!invitation.allowsMealRequests) {
    throw new NotFoundException('此邀请未开放点菜请求');
  }
}

export function mealLabel(mealType: MealType) {
  return { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' }[mealType];
}

export function publicMoviePollProfile(poll: Poll, selectedOptionIds: string[]) {
  const options = [...(poll.options ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
  const voterIds = new Set([
    ...options.flatMap((option) => option.votes.map((vote) => `member:${vote.memberId}`)),
    ...options.flatMap((option) => option.guestVotes.map((vote) => `guest:${vote.invitationId}`)),
  ]);
  return {
    id: poll.id,
    title: poll.title,
    description: poll.description,
    voteMode: poll.voteMode,
    maxChoices: poll.maxChoices,
    closesAt: poll.closesAt,
    totalVoters: voterIds.size,
    selectedOptionIds,
    options: options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
      voteCount: option.votes.length + option.guestVotes.length,
      media: option.media
        ? {
            title: option.media.mediaTitle.title,
            originalTitle: option.media.mediaTitle.originalTitle,
            year: option.media.mediaTitle.year,
            posterUrl: option.media.mediaTitle.posterUrl,
          }
        : null,
    })),
  };
}

export function validateWifiPassword(security: GuestWifiSecurity, provided: string | null | undefined) {
  if (security === 'nopass') {
    if (provided && provided.trim()) throw new BadRequestException('开放网络不能设置密码');
    return null;
  }
  const password = provided?.trim() ?? '';
  if (password.length < 8 || password.length > 63) {
    throw new BadRequestException('WPA 网络密码必须为 8 到 63 位');
  }
  return password;
}
