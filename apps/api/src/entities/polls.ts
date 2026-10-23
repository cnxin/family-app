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
import { GuestPollVote } from './guests';
import { Household, Member } from './household';
import { HouseholdMedia } from './media';

export type PollCategory = 'general' | 'meal' | 'activity' | 'movie' | 'shopping';

export type PollVoteMode = 'single' | 'multiple';

export type PollStatus = 'open' | 'closed';

@Entity('polls')
@Check(
  'CHK_polls_category',
  `"category" IN ('general', 'meal', 'activity', 'movie', 'shopping')`,
)
@Check('CHK_polls_vote_mode', `"voteMode" IN ('single', 'multiple')`)
@Check('CHK_polls_status', `"status" IN ('open', 'closed')`)
@Check(
  'CHK_polls_max_choices',
  `("voteMode" = 'single' AND "maxChoices" = 1) OR ("voteMode" = 'multiple' AND "maxChoices" >= 1 AND "maxChoices" <= 12)`,
)
@Check(
  'CHK_polls_source_pair',
  `("sourceModule" IS NULL AND "sourceId" IS NULL) OR ("sourceModule" IS NOT NULL AND "sourceId" IS NOT NULL)`,
)
@Index('IDX_polls_household_active', [
  'householdId',
  'isArchived',
  'status',
  'createdAt',
])
@Index(
  'UQ_polls_active_media_source',
  ['householdId', 'sourceModule', 'sourceId'],
  {
    unique: true,
    where: `"sourceModule" = 'media' AND "isArchived" = false AND "status" = 'open'`,
  },
)
export class Poll {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_polls_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', default: 'general' })
  category: PollCategory;

  @Column({ type: 'varchar', default: 'single' })
  voteMode: PollVoteMode;

  @Column({ type: 'int', default: 1 })
  maxChoices: number;

  @Column({ type: 'timestamptz', nullable: true })
  closesAt: Date | null;

  @Column({ type: 'varchar', default: 'open' })
  status: PollStatus;

  @Column({ type: 'varchar', length: 40, nullable: true })
  sourceModule: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceId: string | null;

  @Column({ default: false })
  isArchived: boolean;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_polls_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'closedById',
    foreignKeyConstraintName: 'FK_polls_closed_by',
  })
  closedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  closedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @OneToMany(() => PollOption, (option) => option.poll)
  options: PollOption[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('poll_options')
@Unique('UQ_poll_options_poll_order', ['pollId', 'sortOrder'])
@Index('IDX_poll_options_poll', ['pollId'])
@Index('IDX_poll_options_media', ['mediaId'])
@Index('UQ_poll_options_poll_media', ['pollId', 'mediaId'], { unique: true })
export class PollOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Poll, (poll) => poll.options, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'pollId',
    foreignKeyConstraintName: 'FK_poll_options_poll',
  })
  poll: Poll;

  @Column('uuid')
  pollId: string;

  @Column({ type: 'varchar', length: 120 })
  label: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @ManyToOne(() => HouseholdMedia, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaId',
    foreignKeyConstraintName: 'FK_poll_options_media',
  })
  media: HouseholdMedia | null;

  @Column({ type: 'uuid', nullable: true })
  mediaId: string | null;

  @Column({ type: 'int' })
  sortOrder: number;

  @OneToMany(() => PollVote, (vote) => vote.option)
  votes: PollVote[];

  @OneToMany(() => GuestPollVote, (vote) => vote.option)
  guestVotes: GuestPollVote[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('poll_votes')
@Unique('UQ_poll_votes_poll_option_member', ['pollId', 'optionId', 'memberId'])
@Index('IDX_poll_votes_household_poll', ['householdId', 'pollId'])
@Index('IDX_poll_votes_member_poll', ['memberId', 'pollId'])
export class PollVote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_poll_votes_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Poll, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'pollId',
    foreignKeyConstraintName: 'FK_poll_votes_poll',
  })
  poll: Poll;

  @Column('uuid')
  pollId: string;

  @ManyToOne(() => PollOption, (option) => option.votes, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'optionId',
    foreignKeyConstraintName: 'FK_poll_votes_option',
  })
  option: PollOption;

  @Column('uuid')
  optionId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_poll_votes_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
