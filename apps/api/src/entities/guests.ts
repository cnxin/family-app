import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Household, Member } from './household';
import { MealType, MenuItem } from './menus';
import { Poll, PollOption } from './polls';

export type VisitStatus = 'scheduled' | 'cancelled' | 'completed';

export type GuestWifiSecurity = 'WPA' | 'nopass';

export type GuestMealRequestStatus = 'pending' | 'accepted' | 'rejected';

@Entity('guests')
@Index('IDX_guests_household_name', ['householdId', 'name'])
export class Guest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_guests_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 16, default: '👋' })
  avatarEmoji: string;

  @Column({ type: 'varchar', length: 240, nullable: true })
  note: string | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  anonymizedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('visits')
@Check('CHK_visits_status', `"status" IN ('scheduled', 'cancelled', 'completed')`)
@Index('IDX_visits_household_start', ['householdId', 'startsAt'])
export class Visit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_visits_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', default: 'scheduled' })
  status: VisitStatus;

  @ManyToOne(() => GuestWifiProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'guestWifiProfileId',
    foreignKeyConstraintName: 'FK_visits_guest_wifi_profile',
  })
  guestWifiProfile: GuestWifiProfile | null;

  @Column({ type: 'uuid', nullable: true })
  guestWifiProfileId: string | null;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'hostMemberId',
    foreignKeyConstraintName: 'FK_visits_host_member',
  })
  hostMember: Member;

  @Column('uuid')
  hostMemberId: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_visits_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @OneToMany(() => VisitGuest, (visitGuest) => visitGuest.visit)
  guests: VisitGuest[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('visit_guests')
@Unique('UQ_visit_guests_visit_guest', ['visitId', 'guestId'])
@Index('IDX_visit_guests_guest', ['guestId'])
export class VisitGuest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Visit, (visit) => visit.guests, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'visitId',
    foreignKeyConstraintName: 'FK_visit_guests_visit',
  })
  visit: Visit;

  @Column('uuid')
  visitId: string;

  @ManyToOne(() => Guest, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'guestId',
    foreignKeyConstraintName: 'FK_visit_guests_guest',
  })
  guest: Guest;

  @Column('uuid')
  guestId: string;

  @Column({ type: 'boolean', nullable: true })
  isAttending: boolean | null;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('guest_invitations')
@Index('UQ_guest_invitations_token_hash', ['tokenHash'], { unique: true })
@Index('IDX_guest_invitations_visit_guest', ['visitId', 'guestId'])
export class GuestInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Visit, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'visitId',
    foreignKeyConstraintName: 'FK_guest_invitations_visit',
  })
  visit: Visit;

  @Column('uuid')
  visitId: string;

  @ManyToOne(() => Guest, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'guestId',
    foreignKeyConstraintName: 'FK_guest_invitations_guest',
  })
  guest: Guest;

  @Column('uuid')
  guestId: string;

  @Column({ type: 'varchar', length: 64, select: false })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ default: false })
  allowsMovieVoting: boolean;

  @Column({ default: false })
  allowsMealRequests: boolean;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_guest_invitations_created_by',
  })
  createdBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @OneToMany(() => GuestPollVote, (vote) => vote.invitation)
  pollVotes: GuestPollVote[];

  @OneToMany(() => GuestMealRequest, (request) => request.invitation)
  mealRequests: GuestMealRequest[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('guest_wifi_profiles')
@Check('CHK_guest_wifi_profiles_security', `"security" IN ('WPA', 'nopass')`)
@Index('IDX_guest_wifi_profiles_household_active', ['householdId', 'isActive'])
export class GuestWifiProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_guest_wifi_profiles_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  ssid: string;

  @Column({ type: 'varchar', length: 8 })
  security: GuestWifiSecurity;

  @Column({ type: 'text', nullable: true, select: false })
  passwordEncrypted: string | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('guest_poll_votes')
@Unique('UQ_guest_poll_votes_poll_invitation_option', ['pollId', 'invitationId', 'optionId'])
@Index('IDX_guest_poll_votes_household_poll', ['householdId', 'pollId'])
@Index('IDX_guest_poll_votes_invitation_poll', ['invitationId', 'pollId'])
export class GuestPollVote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_guest_poll_votes_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => GuestInvitation, (invitation) => invitation.pollVotes, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'invitationId',
    foreignKeyConstraintName: 'FK_guest_poll_votes_invitation',
  })
  invitation: GuestInvitation;

  @Column('uuid')
  invitationId: string;

  @ManyToOne(() => Poll, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'pollId',
    foreignKeyConstraintName: 'FK_guest_poll_votes_poll',
  })
  poll: Poll;

  @Column('uuid')
  pollId: string;

  @ManyToOne(() => PollOption, (option) => option.guestVotes, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'optionId',
    foreignKeyConstraintName: 'FK_guest_poll_votes_option',
  })
  option: PollOption;

  @Column('uuid')
  optionId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('guest_meal_requests')
@Check('CHK_guest_meal_requests_status', `"status" IN ('pending', 'accepted', 'rejected')`)
@Index('UQ_guest_meal_requests_invitation_menu_item', ['invitationId', 'menuItemId'], {
  unique: true,
  where: `"menuItemId" IS NOT NULL`,
})
@Index('IDX_guest_meal_requests_household_visit', ['householdId', 'visitId'])
export class GuestMealRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_guest_meal_requests_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Visit, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'visitId',
    foreignKeyConstraintName: 'FK_guest_meal_requests_visit',
  })
  visit: Visit;

  @Column('uuid')
  visitId: string;

  @ManyToOne(() => GuestInvitation, (invitation) => invitation.mealRequests, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'invitationId',
    foreignKeyConstraintName: 'FK_guest_meal_requests_invitation',
  })
  invitation: GuestInvitation;

  @Column('uuid')
  invitationId: string;

  @ManyToOne(() => MenuItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'menuItemId',
    foreignKeyConstraintName: 'FK_guest_meal_requests_menu_item',
  })
  menuItem: MenuItem | null;

  @Column({ type: 'uuid', nullable: true })
  menuItemId: string | null;

  @Column({ type: 'date' })
  mealDate: string;

  @Column({ type: 'varchar' })
  mealType: MealType;

  @Column({ type: 'varchar', length: 120 })
  dishName: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: GuestMealRequestStatus;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reviewNote: string | null;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'reviewedById',
    foreignKeyConstraintName: 'FK_guest_meal_requests_reviewed_by',
  })
  reviewedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
