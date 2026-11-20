import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// 1. Users
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(),
    email: text('email').notNull(),
    username: text('username').notNull().unique(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    coverUrl: text('cover_url'),
    bio: text('bio').default(''),
    role: text('role').notNull().default('user'), // 'user' | 'moderator' | 'admin'
    isBanned: boolean('is_banned').notNull().default(false),
    isVerified: boolean('is_verified').notNull().default(false),
    plan: text('plan').notNull().default('free'), // 'free' | 'plus' | 'pro'
    storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'number' }).notNull().default(104857600), // 100 MB Free
    storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0),
    aiCreditsUsed: integer('ai_credits_used').notNull().default(0),
    aiCreditsLimit: integer('ai_credits_limit').notNull().default(30),
    isOnline: boolean('is_online').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at').defaultNow(),
    publicKeyJwk: jsonb('public_key_jwk'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('users_username_idx').on(table.username),
    index('users_email_idx').on(table.email),
  ]
);

// 2. Profiles
export const profiles = pgTable('profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  location: text('location').default(''),
  website: text('website').default(''),
  workplace: text('workplace').default(''),
  education: text('education').default(''),
  birthdate: text('birthdate').default(''),
  privacySettings: jsonb('privacy_settings')
    .$type<{
      profileVisibility: 'public' | 'friends' | 'private';
      messagePrivacy: 'everyone' | 'friends';
      storyPrivacy: 'public' | 'friends';
      showOnlineStatus: boolean;
      allowLocationServices?: boolean;
      shareLiveWithFriends?: boolean;
    }>()
    .default({
      profileVisibility: 'public',
      messagePrivacy: 'everyone',
      storyPrivacy: 'public',
      showOnlineStatus: true,
      allowLocationServices: false,
      shareLiveWithFriends: false,
    })
    .notNull(),
  notificationSettings: jsonb('notification_settings')
    .$type<{
      messages: boolean;
      friends: boolean;
      reactions: boolean;
      comments: boolean;
      live: boolean;
    }>()
    .default({
      messages: true,
      friends: true,
      reactions: true,
      comments: true,
      live: true,
    })
    .notNull(),
  language: text('language').notNull().default('ar'),
  theme: text('theme').notNull().default('dark'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 3. Friends
export const friends = pgTable(
  'friends',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    friendId: integer('friend_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('friends_pair_idx').on(table.userId, table.friendId)]
);

// 4. Friend Requests
export const friendRequests = pgTable(
  'friend_requests',
  {
    id: serial('id').primaryKey(),
    senderId: integer('sender_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    receiverId: integer('receiver_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'accepted' | 'rejected'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('friend_requests_receiver_idx').on(table.receiverId, table.status)]
);

// 5. Followers
export const followers = pgTable(
  'followers',
  {
    id: serial('id').primaryKey(),
    followerId: integer('follower_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    followingId: integer('following_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('followers_pair_idx').on(table.followerId, table.followingId)]
);

// Blocked Users
export const blockedUsers = pgTable(
  'blocked_users',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    blockedUserId: integer('blocked_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('blocked_pair_idx').on(table.userId, table.blockedUserId)]
);

// 6. Groups
export const groups = pgTable('groups', {
  id: serial('id').primaryKey(),
  creatorId: integer('creator_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  description: text('description').default(''),
  avatarUrl: text('avatar_url'),
  coverUrl: text('cover_url'),
  privacy: text('privacy').notNull().default('public'), // 'public' | 'private'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 7. Group Members
export const groupMembers = pgTable(
  'group_members',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .references(() => groups.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull().default('member'), // 'admin' | 'moderator' | 'member'
    status: text('status').notNull().default('active'), // 'active' | 'pending'
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('group_member_idx').on(table.groupId, table.userId)]
);

// 8. Pages
export const pages = pgTable('pages', {
  id: serial('id').primaryKey(),
  ownerId: integer('owner_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  category: text('category').notNull().default('Creator'),
  description: text('description').default(''),
  avatarUrl: text('avatar_url'),
  coverUrl: text('cover_url'),
  isBusiness: boolean('is_business').notNull().default(false),
  followersCount: integer('followers_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 9. Page Followers
export const pageFollowers = pgTable(
  'page_followers',
  {
    id: serial('id').primaryKey(),
    pageId: integer('page_id')
      .references(() => pages.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull().default('follower'), // 'follower' | 'admin' | 'editor'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('page_follower_idx').on(table.pageId, table.userId)]
);

// 10. Posts
export const posts = pgTable(
  'posts',
  {
    id: serial('id').primaryKey(),
    authorId: integer('author_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    pageId: integer('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    groupId: integer('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    content: text('content').default(''),
    postType: text('post_type').notNull().default('text'), // 'text' | 'image' | 'carousel' | 'video' | 'link' | 'pdf' | 'poll' | 'colored'
    backgroundStyle: text('background_style'),
    linkUrl: text('link_url'),
    linkTitle: text('link_title'),
    location: text('location'),
    locationData: jsonb('location_data').$type<{ lat: number; lng: number; label: string } | null>(),
    hashtags: jsonb('hashtags').$type<string[]>().default([]).notNull(),
    mentions: jsonb('mentions').$type<string[]>().default([]).notNull(),
    pollOptions: jsonb('poll_options').$type<Array<{ id: string; text: string; voterIds: number[] }>>(),
    privacy: text('privacy').notNull().default('public'), // 'public' | 'friends' | 'private'
    isPinned: boolean('is_pinned').notNull().default(false),
    commentsDisabled: boolean('comments_disabled').notNull().default(false),
    isDraft: boolean('is_draft').notNull().default(false),
    viewsCount: integer('views_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('posts_author_idx').on(table.authorId),
    index('posts_created_idx').on(table.createdAt),
  ]
);

// 11. Post Media
export const postMedia = pgTable('post_media', {
  id: serial('id').primaryKey(),
  postId: integer('post_id')
    .references(() => posts.id, { onDelete: 'cascade' })
    .notNull(),
  mediaType: text('media_type').notNull(), // 'image' | 'video' | 'pdf' | 'file'
  url: text('url').notNull(),
  fileName: text('file_name'),
  mimeType: text('mime_type'),
  fileSize: integer('file_size'),
  sortOrder: integer('sort_order').notNull().default(0),
});

// 12. Comments
export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  postId: integer('post_id')
    .references(() => posts.id, { onDelete: 'cascade' })
    .notNull(),
  authorId: integer('author_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  parentId: integer('parent_id'),
  content: text('content').notNull(),
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 13. Comment Reactions
export const commentReactions = pgTable(
  'comment_reactions',
  {
    id: serial('id').primaryKey(),
    commentId: integer('comment_id')
      .references(() => comments.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    reactionType: text('reaction_type').notNull().default('like'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('comment_reaction_idx').on(table.commentId, table.userId)]
);

// 14. Post Reactions
export const postReactions = pgTable(
  'post_reactions',
  {
    id: serial('id').primaryKey(),
    postId: integer('post_id')
      .references(() => posts.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    reactionType: text('reaction_type').notNull(), // 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('post_reaction_idx').on(table.postId, table.userId)]
);

// 15. Shares
export const shares = pgTable('shares', {
  id: serial('id').primaryKey(),
  postId: integer('post_id')
    .references(() => posts.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  comment: text('comment').default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 16. Saved Posts
export const savedPosts = pgTable(
  'saved_posts',
  {
    id: serial('id').primaryKey(),
    postId: integer('post_id')
      .references(() => posts.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('saved_post_idx').on(table.postId, table.userId)]
);

// 17. Stories
export const stories = pgTable('stories', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  mediaUrl: text('media_url'),
  mediaType: text('media_type').notNull().default('image'), // 'image' | 'video' | 'text'
  textOverlay: text('text_overlay').default(''),
  backgroundColor: text('background_color').default('#18181b'),
  stickers: jsonb('stickers').$type<Array<{ id: string; label: string; x: number; y: number }>>().default([]),
  musicTitle: text('music_title'),
  privacy: text('privacy').notNull().default('public'),
  isHighlighted: boolean('is_highlighted').notNull().default(false),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 18. Story Views
export const storyViews = pgTable(
  'story_views',
  {
    id: serial('id').primaryKey(),
    storyId: integer('story_id')
      .references(() => stories.id, { onDelete: 'cascade' })
      .notNull(),
    viewerId: integer('viewer_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    replyText: text('reply_text'),
    viewedAt: timestamp('viewed_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('story_view_idx').on(table.storyId, table.viewerId)]
);

// 19. Reels
export const reels = pgTable('reels', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  videoUrl: text('video_url').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  caption: text('caption').default(''),
  hashtags: jsonb('hashtags').$type<string[]>().default([]).notNull(),
  musicTitle: text('music_title').default('Original Audio'),
  viewsCount: integer('views_count').notNull().default(0),
  likesCount: integer('likes_count').notNull().default(0),
  commentsCount: integer('comments_count').notNull().default(0),
  sharesCount: integer('shares_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 20. Reel Views / Interactions
export const reelViews = pgTable(
  'reel_views',
  {
    id: serial('id').primaryKey(),
    reelId: integer('reel_id')
      .references(() => reels.id, { onDelete: 'cascade' })
      .notNull(),
    viewerId: integer('viewer_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    liked: boolean('liked').notNull().default(false),
    saved: boolean('saved').notNull().default(false),
    viewedAt: timestamp('viewed_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('reel_view_idx').on(table.reelId, table.viewerId)]
);

// Reel Comments
export const reelComments = pgTable('reel_comments', {
  id: serial('id').primaryKey(),
  reelId: integer('reel_id')
    .references(() => reels.id, { onDelete: 'cascade' })
    .notNull(),
  authorId: integer('author_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 21. Chats
export const chats = pgTable('chats', {
  id: serial('id').primaryKey(),
  chatType: text('chat_type').notNull().default('direct'), // 'direct' | 'group'
  name: text('name'),
  avatarUrl: text('avatar_url'),
  groupId: integer('group_id').references(() => groups.id, { onDelete: 'set null' }),
  createdBy: integer('created_by')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 22. Chat Members
export const chatMembers = pgTable(
  'chat_members',
  {
    id: serial('id').primaryKey(),
    chatId: integer('chat_id')
      .references(() => chats.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull().default('member'), // 'admin' | 'member'
    isPinned: boolean('is_pinned').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    isMuted: boolean('is_muted').notNull().default(false),
    lastReadAt: timestamp('last_read_at').defaultNow(),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('chat_member_idx').on(table.chatId, table.userId)]
);

// 23. Messages
export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    chatId: integer('chat_id')
      .references(() => chats.id, { onDelete: 'cascade' })
      .notNull(),
    senderId: integer('sender_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    replyToId: integer('reply_to_id'),
    forwardedFromId: integer('forwarded_from_id'),
    content: text('content').default(''),
    messageType: text('message_type').notNull().default('text'), // 'text' | 'image' | 'video' | 'document' | 'audio' | 'location' | 'encrypted'
    encryptedPayload: jsonb('encrypted_payload').$type<{
      ciphertext: string;
      iv: string;
      senderKeyFingerprint: string;
      algorithm: string;
    }>(),
    locationData: jsonb('location_data').$type<{
      lat: number;
      lng: number;
      label: string;
      liveShareId?: number;
      isLive?: boolean;
      expiresAt?: string;
      durationMinutes?: number;
      stopped?: boolean;
    }>(),
    reactions: jsonb('reactions').$type<Record<string, number[]>>().default({}).notNull(),
    isEdited: boolean('is_edited').notNull().default(false),
    isDeleted: boolean('is_deleted').notNull().default(false),
    readBy: jsonb('read_by').$type<number[]>().default([]).notNull(),
    deliveredTo: jsonb('delivered_to').$type<number[]>().default([]).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('messages_chat_idx').on(table.chatId, table.createdAt)]
);

// 24. Message Attachments
export const messageAttachments = pgTable('message_attachments', {
  id: serial('id').primaryKey(),
  messageId: integer('message_id')
    .references(() => messages.id, { onDelete: 'cascade' })
    .notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  url: text('url').notNull(),
});

// 25. Notifications
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').notNull(), // 'message' | 'friend_request' | 'reaction' | 'comment' | 'share' | 'mention' | 'follow' | 'group' | 'page' | 'file_share' | 'live'
    title: text('title').notNull(),
    body: text('body').notNull(),
    entityType: text('entity_type'),
    entityId: integer('entity_id'),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('notifications_user_idx').on(table.userId, table.isRead)]
);

// 26. Cloud Folders
export const cloudFolders = pgTable('cloud_folders', {
  id: serial('id').primaryKey(),
  ownerId: integer('owner_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  parentId: integer('parent_id'),
  name: text('name').notNull(),
  isTrashed: boolean('is_trashed').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 27. Cloud Files
export const cloudFiles = pgTable(
  'cloud_files',
  {
    id: serial('id').primaryKey(),
    ownerId: integer('owner_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    folderId: integer('folder_id').references(() => cloudFolders.id, { onDelete: 'set null' }),
    fileName: text('file_name').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    storagePath: text('storage_path').notNull(),
    publicUrl: text('public_url').notNull(),
    extractedText: text('extracted_text').default(''),
    isTrashed: boolean('is_trashed').notNull().default(false),
    trashedAt: timestamp('trashed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('cloud_files_owner_idx').on(table.ownerId, table.isTrashed)]
);

// 28. File Shares
export const fileShares = pgTable('file_shares', {
  id: serial('id').primaryKey(),
  fileId: integer('file_id').references(() => cloudFiles.id, { onDelete: 'cascade' }),
  folderId: integer('folder_id').references(() => cloudFolders.id, { onDelete: 'cascade' }),
  ownerId: integer('owner_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  sharedWithUserId: integer('shared_with_user_id').references(() => users.id, { onDelete: 'cascade' }),
  shareToken: text('share_token').notNull().unique(),
  permission: text('permission').notNull().default('view'), // 'view' | 'edit'
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 29. AI Conversations
export const aiConversations = pgTable('ai_conversations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull().default('محادثة جديدة'),
  mode: text('mode').notNull().default('assistant'), // 'assistant' | 'drive_ai' | 'image'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 30. AI Messages
export const aiMessages = pgTable('ai_messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id')
    .references(() => aiConversations.id, { onDelete: 'cascade' })
    .notNull(),
  role: text('role').notNull(), // 'user' | 'model'
  content: text('content').notNull(),
  imageUrl: text('image_url'),
  referencedFileIds: jsonb('referenced_file_ids').$type<number[]>().default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 31. Subscriptions
export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  plan: text('plan').notNull().default('free'), // 'free' | 'plus' | 'pro'
  status: text('status').notNull().default('active'), // 'active' | 'cancelled' | 'pending_payment'
  amountUsd: integer('amount_usd').notNull().default(0),
  billingCycle: text('billing_cycle').notNull().default('monthly'),
  currentPeriodEnd: timestamp('current_period_end'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 32. Payments
export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  subscriptionId: integer('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
  amountUsd: integer('amount_usd').notNull(),
  currency: text('currency').notNull().default('USD'),
  status: text('status').notNull().default('pending'), // 'pending' | 'verified' | 'failed'
  provider: text('provider').notNull().default('stripe'),
  transactionRef: text('transaction_ref').notNull(),
  invoiceNumber: text('invoice_number').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 33. Live Streams
export const liveStreams = pgTable('live_streams', {
  id: serial('id').primaryKey(),
  hostId: integer('host_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  description: text('description').default(''),
  status: text('status').notNull().default('live'), // 'live' | 'ended'
  viewersCount: integer('viewers_count').notNull().default(0),
  recordingUrl: text('recording_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  endedAt: timestamp('ended_at'),
});

// 34. Reports
export const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  reporterId: integer('reporter_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  targetType: text('target_type').notNull(), // 'post' | 'comment' | 'user' | 'file' | 'stream' | 'group'
  targetId: integer('target_id').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('open'), // 'open' | 'resolved' | 'dismissed'
  resolvedBy: integer('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 35. Admin Logs
export const adminLogs = pgTable('admin_logs', {
  id: serial('id').primaryKey(),
  adminId: integer('admin_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: integer('target_id'),
  details: jsonb('details').$type<Record<string, unknown>>().default({}).notNull(),
  ipAddress: text('ip_address').default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 36. User Sessions
export const userSessions = pgTable('user_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  deviceInfo: text('device_info').notNull(),
  ipAddress: text('ip_address').default(''),
  lastActiveAt: timestamp('last_active_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 37. Ephemeral Live Location Shares (coordinates are wiped when stopped/expired)
export const liveLocationShares = pgTable(
  'live_location_shares',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }),
    shareScope: text('share_scope').notNull().default('chat'), // 'chat' | 'friends'
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    accuracy: doublePrecision('accuracy'),
    label: text('label').default(''),
    durationMinutes: integer('duration_minutes').notNull().default(15), // 15 | 60 | 480
    expiresAt: timestamp('expires_at').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    stoppedAt: timestamp('stopped_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('live_loc_user_active_idx').on(table.userId, table.isActive),
    index('live_loc_chat_active_idx').on(table.chatId, table.isActive),
  ]
);

// 38. Saved & Shared Map Places
export const savedPlaces = pgTable(
  'saved_places',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    description: text('description').default(''),
    category: text('category').notNull().default('place'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    address: text('address').default(''),
    visibility: text('visibility').notNull().default('private'), // 'private' | 'friends'
    sharedWithUserIds: jsonb('shared_with_user_ids').$type<number[]>().default([]).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('saved_places_user_idx').on(table.userId)]
);

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
  posts: many(posts),
  stories: many(stories),
  reels: many(reels),
  cloudFiles: many(cloudFiles),
  notifications: many(notifications),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  media: many(postMedia),
  comments: many(comments),
  reactions: many(postReactions),
}));

export const chatsRelations = relations(chats, ({ many }) => ({
  members: many(chatMembers),
  messages: many(messages),
}));
