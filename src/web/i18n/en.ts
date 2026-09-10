export const en = {
  locale: {
    label: "Language",
    switch: "Interface language",
  },
  crash: {
    title: "The interface stopped unexpectedly",
    reload: "Reload Bobarr",
  },
  common: {
    loading: "Loading",
    loadingEllipsis: "Loading…",
    tryAgain: "Try again",
    closeDialog: "Close dialog",
    progress: "Progress",
    loadingTitles: "Loading titles",
    requestId: ({ id }: { id: string }) => `Request ${id}`,
    somethingWentWrong: "Something went wrong",
    requestFailed: "The request could not be completed.",
    cancel: "Cancel",
    back: "Back",
    refresh: "Refresh",
    loadMore: "Load more",
    download: "Download",
    test: "Test",
    delete: "Delete",
    revoke: "Revoke",
    dismiss: "Dismiss",
    save: "Save",
    chooseFile: "Choose file",
    optional: "Optional",
    configured: "Configured",
    notConfigured: "Not configured",
    calculating: "Calculating",
    yearUnknown: "Year unknown",
    genres: "Genres",
    integration: "Integration",
    files: ({ count }: { count: number }) =>
      count === 1 ? "1 file" : `${count} files`,
    bytesOf: ({ from, to }: { from: string; to: string }) => `${from} of ${to}`,
    eta: ({ value }: { value: string }) => `ETA ${value}`,
    ratingAria: ({
      source,
      value,
      scale,
    }: {
      source: string;
      value: string;
      scale: number;
    }) => `${source} rating ${value} out of ${scale}`,
    ratingVotesAria: ({
      source,
      value,
      scale,
      votes,
    }: {
      source: string;
      value: string;
      scale: number;
      votes: string;
    }) => `${source} rating ${value} out of ${scale}, ${votes} votes`,
    downloadProgress: ({ title }: { title: string }) =>
      `${title} download progress`,
    speed: "Speed",
  },
  status: {
    searching: "Searching",
    queued: "Queued",
    downloading: "Downloading",
    organizing: "Organizing",
    available: "Available",
    missing: "Missing",
    failed: "Failed",
    unmonitored: "Unmonitored",
    paused: "Paused",
    seeding: "Seeding",
    checking: "Checking",
    completed: "Completed",
    pending: "Pending",
    running: "Running",
    retrying: "Retrying",
    cancelled: "Cancelled",
  },
  dates: {
    unknown: "Unknown date",
    tba: "TBA",
  },
  routeError: {
    notFoundTitle: "That page wandered off",
    errorTitle: "Bobarr hit a snag",
    notFoundDescription: "The page you requested doesn’t exist.",
    loadFailed: "The page could not be loaded.",
    backToDiscover: "Back to Discover",
  },
  nav: {
    main: "Main navigation",
    mobile: "Mobile navigation",
    browse: "Browse",
    library: "Library",
    system: "System",
    discover: "Discover",
    search: "Search",
    suggestions: "Suggestions",
    movies: "Movies",
    shows: "Shows",
    calendar: "Calendar",
    activity: "Activity",
    settings: "Settings",
    account: "Account",
    more: "More",
    moreTitle: "More from Bobarr",
    moreEyebrow: "Navigation",
    closeMenu: "Close menu",
    signOut: "Sign out",
    version: "Bobarr v2",
    statusReady: "All systems ready",
    statusDegraded: "Service degraded",
    statusUnavailable: "Service unavailable",
    degraded: "Degraded",
    offline: "Bobarr is offline. We’ll keep trying to reconnect.",
    warmingUp: "Warming up your library…",
  },
  auth: {
    about: "About Bobarr",
    privateByDesign: "Private by design",
    storyTitleLine1: "Your watchlist,",
    storyTitleLine2: "quietly automated.",
    storyBody:
      "Find a title. Bobarr handles the search, the download, and the filing on infrastructure you own.",
    featureJackett: "Jackett-powered release search",
    featureTransmission: "Transmission safely behind the API",
    featureOrganize: "Files organized without giving up seeding",
    footer: "Bobarr runs entirely on your server.",
    username: "Username",
    password: "Password",
    confirmPassword: "Confirm password",
    loginEyebrow: "Welcome back",
    loginTitle: "Sign in to Bobarr",
    loginDescription: "Use your Bobarr username and password.",
    signIn: "Sign in",
    lostAccessLead: "Lost access?",
    lostAccessRest: " Reset the administrator password from the Bobarr host.",
    enterUsername: "Enter your username.",
    enterPassword: "Enter your password.",
    setupEyebrow: "First run",
    setupTitle: "Make Bobarr yours",
    setupDescription:
      "Create the single administrator account. You can configure services next.",
    adminUsername: "Administrator username",
    passwordHint: "Any non-empty password",
    createAdministrator: "Create administrator",
    checkingServer: "Checking server…",
    setupHelp:
      "Your password is hashed with Argon2id. Connector secrets are encrypted separately.",
    minUsername: "Use at least 3 characters.",
    enterAPassword: "Enter a password.",
    passwordsMismatch: "Passwords do not match.",
    inviteEyebrow: "Invite",
    inviteInvalidTitle: "This invite isn’t valid",
    inviteInvalidDescription:
      "Ask an administrator for a new link. Used and expired invites cannot be reused.",
    goToSignIn: "Go to sign in",
    checkingInvite: "Checking invite…",
    invitedEyebrow: "You're invited",
    inviteTitle: "Create your Bobarr account",
    inviteDescription:
      "Choose a username and password. You’ll share this library with the people already here.",
    join: "Join Bobarr",
    unavailableEyebrow: "Server unavailable",
    unavailableTitle: "Bobarr isn’t responding",
    unavailableDescription:
      "Check that the container is running, then refresh this page.",
  },
  account: {
    eyebrow: "Account",
    title: "Your sign-in",
    description: "Change the username and password for this account.",
    languageTitle: "Language",
    languageDescription:
      "Choose the language for Bobarr’s menus and labels. This is separate from the metadata language used for titles.",
    username: "Username",
    newPassword: "New password",
    confirmNewPassword: "Confirm new password",
    passwordHint: "Leave blank to keep the current password.",
    updated: "Sign-in details updated.",
    updateLogin: "Update login",
    minUsername: "Use at least 3 characters.",
    usernameCharset: "Use letters, numbers, dots, underscores, or dashes.",
    passwordsMismatch: "Passwords do not match.",
  },
  kind: {
    movie: "Movie",
    series: "Series",
    all: "All",
    everything: "Everything",
    shows: "Shows",
    tvShow: "TV show",
    tvShows: "TV Shows",
  },
  search: {
    eyebrow: "TMDB catalog",
    title: "Find your next favorite",
    description:
      "Search movies and television, then let Bobarr take care of the rest.",
    inputLabel: "Search movies and shows",
    placeholder: "Search movies and shows…",
    clear: "Clear search",
    submit: "Search",
    mediaType: "Media type",
    promptTitle: "What are you looking for?",
    promptBody:
      "Search by title. Results are matched with TMDB metadata before acquisition.",
    noMatchesTitle: "No matches",
    noMatches: ({ query }: { query: string }) =>
      `We couldn’t find anything matching “${query}”. Check the spelling or try another title.`,
    results: "Results",
    titleCount: ({ count }: { count: number }) =>
      count === 1 ? "1 title" : `${count} titles`,
  },
  discover: {
    eyebrow: "Explore",
    title: "Discover something remarkable",
    description:
      "Search, get suggestions, or browse popular and acclaimed titles in one place.",
    mediaType: "Media type",
    advancedSearch: "Advanced search",
    suggestionsLink: "Suggestions",
    hideOwned: "Hide owned",
    showOwned: "Show owned",
    filters: "Filters",
    refineEyebrow: "Refine discovery",
    refineTitle: "Find your next watch",
    refineDescription: "Stack filters, then apply them together.",
    highestRatedVoteHint: "Highest rated defaults to 200+ votes.",
    defaultVotes: ({ count }: { count: number }) =>
      `Default · ${count.toLocaleString("en-US")}+ votes`,
    genres: "Genres",
    matchAnyGenre: "Match any selected genre.",
    loadingGenres: "Loading genres…",
    genresUnavailable: "Genres are temporarily unavailable.",
    originAndLanguage: "Origin & language",
    originHint: "Filter where a title came from and its original audio.",
    configUnavailable:
      "Some TMDB configuration choices are temporarily unavailable.",
    anyCountry: "Any country",
    anyLanguage: "Any language",
    releaseWindow: "Release window",
    releaseWindowHint: "Use one exact year or a custom date range.",
    lengthAndQuality: "Length & quality",
    lengthHint: "Narrow the time commitment and audience rating.",
    applied: "Applied",
    reset: "Reset",
    applyFilters: "Apply filters",
    clearAll: "Clear all",
    noActiveFilters: "No active filters",
    activeFilters: ({ count }: { count: number }) =>
      count === 1 ? "1 active filter" : `${count} active filters`,
    removeFilter: ({ label }: { label: string }) => `Remove ${label} filter`,
    pageOf: ({ page, total }: { page: number; total: number }) =>
      `Page ${page} of ${total}`,
    yearRange: "Year must be a whole number from 1874 to 2200.",
    startDateRange: "Start date must be from 1874-01-01 to 2200-12-31.",
    endDateRange: "End date must be from 1874-01-01 to 2200-12-31.",
    runtimeOrder: "Maximum length must be at least the minimum length.",
    dateOrder: "The end date must be on or after the start date.",
    closeFilters: "Close filters",
    sortBy: "Sort by",
    minimumVotes: "Minimum votes",
    originCountry: "Country of origin",
    originalLanguage: "Original language",
    exactYear: "Exact year",
    yearPlaceholder: "e.g. 2024",
    dateFrom: "From",
    dateTo: "To",
    minimumLength: "Minimum length",
    maximumLength: "Maximum length",
    minimumRating: "Minimum rating",
    appliedFilters: "Applied filters",
    emptyTitle: "Nothing matches those filters",
    emptyDescription: "Remove a filter or try a broader combination.",
    pages: "Discover pages",
    previousPage: "Previous page",
    nextPage: "Next page",
    anyLength: "Any length",
    minutes: ({ count }: { count: number }) => `${count} minutes`,
    hours: ({ count }: { count: number }) =>
      count === 1 ? "1 hour" : `${count} hours`,
    hoursAndHalf: ({ count }: { count: number }) => `${count}½ hours`,
    anyNumber: "Any number",
    noMinimum: "No minimum",
    votes: ({ count }: { count: number }) =>
      `${count.toLocaleString("en-US")}+ votes`,
    anyRating: "Any rating",
    ratingAndAbove: ({ value }: { value: string }) => `${value} and above`,
    showingOwned: "Showing owned titles",
    actor: ({ name }: { name: string }) => `Actor: ${name}`,
    tmdbPerson: ({ id }: { id: number }) => `TMDB person ${id}`,
    genreFallback: ({ id }: { id: number }) => `Genre ${id}`,
    languagePrefix: ({ name }: { name: string }) => `Language: ${name}`,
    yearPrefix: ({ year }: { year: string }) => `Year: ${year}`,
    until: ({ date }: { date: string }) => `Until ${date}`,
    fromDate: ({ date }: { date: string }) => `From ${date}`,
    dateRange: ({ from, to }: { from: string; to: string }) =>
      `Dates: ${from} – ${to}`,
    lengthRange: ({ lower, upper }: { lower: string; upper: string }) =>
      `Length: ${lower} – ${upper}`,
    minutesShort: ({ count }: { count: string }) => `${count} min`,
    any: "Any",
    rated: ({ value }: { value: string }) => `Rated ${value}+`,
    sort: {
      "popularity.asc": "Least popular",
      "popularity.desc": "Most popular",
      "vote_average.asc": "Lowest rated",
      "vote_average.desc": "Highest rated",
      "vote_count.asc": "Fewest votes",
      "vote_count.desc": "Most voted",
      "release_date.asc": "Oldest first",
      "release_date.desc": "Newest first",
      "primary_release_date.asc": "Oldest first",
      "primary_release_date.desc": "Newest first",
      "first_air_date.asc": "Oldest first",
      "first_air_date.desc": "Newest first",
      "title.asc": "Title A–Z",
      "title.desc": "Title Z–A",
      "name.asc": "Title A–Z",
      "name.desc": "Title Z–A",
      "original_title.asc": "Original title A–Z",
      "original_title.desc": "Original title Z–A",
      "original_name.asc": "Original title A–Z",
      "original_name.desc": "Original title Z–A",
      "revenue.asc": "Lowest box office",
      "revenue.desc": "Highest box office",
    },
  },
  suggestions: {
    eyebrow: "From your library",
    title: "Suggestions with a reason",
    type: "Suggestion type",
    loadingShelves: "Loading suggestion shelves",
    loadError: "Suggestions could not be loaded",
    emptyOtherTab:
      "There are suggestions under another tab, or you can explore the catalog for a different starting point.",
    scrollLeft: ({ title }: { title: string }) =>
      `Scroll ${title} suggestions left`,
    scrollRight: ({ title }: { title: string }) =>
      `Scroll ${title} suggestions right`,
    viewItem: ({ title }: { title: string }) => `View ${title} suggestion`,
    newMix: "New mix",
    basedOnLibrary: "Based on your library",
    inspiredByLibrary: "Inspired by your library",
    moreBasedOnLibrary: ({ kind }: { kind: string }) =>
      `More ${kind} based on your library`,
    becauseInLibrary: ({ title }: { title: string }) =>
      `Because “${title}” is in your library`,
    sourceMeta: ({
      year,
      kind,
      count,
    }: {
      year: string;
      kind: string;
      count: string;
    }) => `${year} · ${kind} · ${count}`,
    suggestionCount: ({ count }: { count: number }) =>
      count === 1 ? "1 suggestion" : `${count} suggestions`,
    scrollInspired: ({ title }: { title: string }) =>
      `Scroll suggestions inspired by ${title}`,
    toolbarSummary: ({
      suggestions,
      titles,
    }: {
      suggestions: string;
      titles: string;
    }) => `${suggestions} from ${titles}`,
    libraryTitleCount: ({ count }: { count: number }) =>
      count === 1 ? "1 library title" : `${count} library titles`,
    defaultDescription:
      "Recommendations organized around the movies and shows you already chose.",
    personalizedDescription:
      "Every shelf starts with a movie or show already in your library.",
    emptyLibraryDescription:
      "Add a few movies or shows and Bobarr will build recommendation shelves around them.",
    shelvesWaiting: "Your recommendation shelves are waiting",
    noFreshMix: "No fresh suggestions in this mix",
    addStartingPoint:
      "Add a movie or show to your library and Bobarr will use it as the starting point for new suggestions.",
    tryAnotherMix:
      "Explore the catalog for something new, or try another mix when one is available.",
    exploreTitles: "Explore titles",
    noKindShelves: ({ kind }: { kind: string }) =>
      `No ${kind} shelves in this mix`,
    viewAll: "View all suggestions",
    forYou: "For you",
    fromYourLibrary: "Suggestions from your library",
    quickMix: "A quick mix before you dive into filters.",
    seeAll: "See all",
    searchCatalog: "Search the catalog…",
    searchCatalogLabel: "Search the catalog",
  },
  calendar: {
    eyebrow: "Schedule",
    title: "Coming to your screen",
    description:
      "Release dates and upcoming episodes from every monitored title.",
    loading: "Loading your calendar…",
    emptyTitle: "Your calendar is clear",
    emptyDescription:
      "Upcoming movies and episodes will appear here once you monitor a show or film.",
    today: "Today",
    releaseCount: ({ count }: { count: number }) =>
      count === 1 ? "1 release" : `${count} releases`,
  },
  library: {
    eyebrow: "Your library",
    moviesDescription:
      "Browse, filter, and keep every film acquisition on track.",
    showsDescription:
      "Browse shows, catch new episodes, and keep monitoring on track.",
    scan: "Scan library",
    type: "Library type",
    summary: "Library summary",
    filterPlaceholder: "Filter your library…",
    availability: "Availability",
    browseFilters: "Browse filters",
    sort: "Sort",
    genre: "Genre",
    year: "Year",
    rating: "Rating",
    quality: "Quality",
    grid: "Library",
    recentlyAdded: "Recently added",
    sortRecentlyAdded: "Recently added",
    sortOldestAdded: "Oldest added",
    sortRecentlyUpdated: "Recently updated",
    sortTitleAsc: "Title A–Z",
    sortTitleDesc: "Title Z–A",
    sortNewestYear: "Newest year",
    sortOldestYear: "Oldest year",
    sortHighestRated: "Highest rated",
    sortLowestRated: "Lowest rated",
    anyQuality: "Any quality",
    anyRating: "Any rating",
    anyGenre: "Any genre",
    anyYear: "Any year",
    available: "Available",
    missing: "Missing",
    active: "Active",
    failed: "Failed",
    all: "All",
    filterMovies: "Filter movies",
    filterShows: "Filter shows",
    clearFilters: "Clear filters",
    scanQueued: "Library scan queued. Follow its progress in Activity.",
    ratingMin: ({ value }: { value: string }) => `${value}+`,
    openDetails: ({ title }: { title: string }) => `Open ${title} details`,
    downloaded: "Downloaded",
    total: "Total",
    inProgress: "In progress",
    airedAndMissing: "Aired & missing",
    upcomingTba: "Upcoming / TBA",
    downloadFolder: "Download folder",
    downloadingTo: "Downloading to",
    inLibrary: "In library",
    episodesReady: ({ ready, total }: { ready: number; total: number }) =>
      `${ready} of ${total} episodes ready`,
    episodeAvailability: ({ title }: { title: string }) =>
      `${title} episode availability`,
    nextEpisode: ({ date }: { date: string }) => `Next episode ${date}`,
    noFileYet: "No file yet · Open to find a release",
    acquisitionNeedsAttention: "Acquisition needs attention · Open to retry",
    openToReplace: "Open to replace or manage files",
    season: ({ n }: { n: number }) => `Season ${n}`,
    thisSeason: "this season",
    entireSeasonPack: "Entire season pack",
    seasonField: "Season",
    seasonHint: "Search a full season pack or narrow the search to an episode.",
    releaseTarget: "Release target",
    releaseTargetHint:
      "Missing, failed, queued, and downloading episodes are listed individually.",
    loadingMonitoredSeasons: "Loading monitored seasons…",
    loadingSeasons: "Loading seasons…",
    loadingEpisodes: "Loading episodes…",
    loadingSeasonDetails: "Loading season details…",
    noMonitoredSeasons: "No monitored seasons",
    noMonitoredSeasonsDescription:
      "Return to management and select at least one season before searching releases.",
    noEpisodeDetails: "No episode details yet",
    noEpisodeDetailsDescription:
      "Bobarr has not received an episode schedule for this season yet.",
    noSeasonDetails: "No season details yet",
    retrySeasonsDescription:
      "Retry loading seasons above, or use the management options here.",
    chooseMonitoringDescription:
      "Choose monitoring settings to add seasons, or remove this title from Bobarr.",
    backToManagement: "Back to management",
    searchJackettHelp:
      "Search Jackett and choose an eligible release. Tracker links and credentials stay on the server; the browser receives only a short-lived candidate ID.",
    noTmdbMatch:
      "Bobarr cannot search this item because it does not have a valid TMDB match.",
    episodeStatus: "Episode status",
    libraryHealth: "Library health",
    libraryStatus: "Library status",
    showSummary: "Show library summary",
    movieSummary: "Movie library summary",
    seasonSummary: "Season summary",
    seasons: "Seasons",
    recommendedActions: "Recommended actions",
    whatToDoNext: "What to do next",
    seasonPackDownloading: "Season pack downloading",
    readyOfTotal: ({ ready, total }: { ready: number; total: number }) =>
      `${ready} of ${total} ready`,
    packDownloadProgress: ({ season }: { season: string }) =>
      `${season} pack download progress`,
    overallEpisodeAvailability: ({ title }: { title: string }) =>
      `${title} overall episode availability`,
    findRelease: "Find release",
    findReleaseFor: ({ code, title }: { code: string; title: string }) =>
      `Find a release for ${code} ${title}`,
    downloadEpisode: ({ code, title }: { code: string; title: string }) =>
      `Download ${code} ${title}`,
    downloadEpisodeFile: ({
      code,
      title,
      file,
    }: {
      code: string;
      title: string;
      file: string;
    }) => `Download ${code} ${title} — ${file}`,
    chooseMonitoring: "Choose monitoring",
    findFirstMissing: "Find first missing episode",
    retryAutomaticSearch: "Retry automatic search",
    searchAnyRelease: "Search any release manually…",
    monitoringSettings: "Monitoring settings",
    automaticMonitoring: "Automatic monitoring",
    automaticMonitoringHint:
      "Controls what Bobarr may search for automatically.",
    doNotMonitor: "Do not monitor",
    selectedSeasons: "Selected seasons",
    allCurrentSeasons: "All current seasons",
    chooseMonitoredSeasons: "Choose monitored seasons",
    monitorFutureSeasons: "Monitor future seasons",
    monitorFutureSeasonsHint:
      "Add newly announced seasons after a metadata refresh.",
    saveMonitoring: "Save monitoring",
    confirmTmdbMatchShow:
      "Confirm this show's TMDB match from the scan review before changing season monitoring.",
    removeFromLibrary: "Remove from library…",
    removeShow: "Remove show…",
    selectedSeasonsSummary: ({
      count,
      future,
    }: {
      count: number;
      future: boolean;
    }) =>
      `${count} selected season${count === 1 ? "" : "s"}${future ? " · future seasons on" : ""}`,
    automaticSearchesOff: "Automatic searches are off",
    futureSeasonsOnly: "Future seasons only",
    ready: "Ready",
    readyMonitoringOff: "Ready · monitoring off",
    notMonitored: "Not monitored",
    needsAttention: "Needs attention",
    upcoming: "Upcoming",
    airDateTba: "Air date TBA",
    airedFileMissing: "Aired · file missing",
    missingEpisodes: "Missing episodes",
    tracked: "Tracked",
    fileReady: "File is ready in your library",
    checkingIndexers: "Checking indexers now",
    releaseSelected: "Release selected · waiting to download",
    movingFile: "Moving the file into your library",
    percentDownloaded: ({ percent }: { percent: number }) =>
      `${percent}% downloaded`,
    downloadInProgress: "Download in progress",
    automaticFailed: "Automatic acquisition failed",
    ignoredByMonitoring: "Ignored by current monitoring",
    airDateNotAnnounced: "The air date has not been announced",
    airsToday: "Airs today",
    airsOn: ({ date }: { date: string }) => `Airs ${date}`,
    airedMissingOn: ({ date }: { date: string }) =>
      `Aired ${date} · no file in library`,
    seasonOnTrack: "This season is on track",
    nothingToDo: "There is nothing you need to do right now.",
    watchingFutureSeasons: "Watching for future seasons",
    watchingFutureSeasonsCopy:
      "Current seasons stay unmonitored. Bobarr will add seasons announced after the current metadata baseline.",
    monitoringOffShow: "Monitoring is off for this show",
    seasonNotMonitored: ({ season }: { season: string }) =>
      `${season} is not monitored`,
    existingFilesStay:
      "Your existing files stay in the library. Choose seasons to let Bobarr fill gaps and follow future episodes.",
    confirmTmdbBeforeMonitoring:
      "Your existing files stay in the library. Confirm this show's TMDB match before turning monitoring on.",
    seasonPackDownloadingTitle: "The season pack is downloading",
    seasonPackDownloadingCopy:
      "Episode files will switch to Ready after Bobarr finishes organizing the pack.",
    airedMissingTitle: ({ count }: { count: number }) =>
      `${count} aired episode${count === 1 ? " is" : "s are"} missing`,
    airedMissingCopy:
      "Bobarr has no library file for these episodes. Retry the automatic search or inspect current releases yourself.",
    inProgressTitle: ({ count }: { count: number }) =>
      `${count} episode${count === 1 ? " is" : "s are"} in progress`,
    inProgressCopy:
      "Bobarr is searching, downloading, or organizing them. No action is needed.",
    caughtUp: "You are caught up",
    willSearchAutomatically: ({ copy }: { copy: string }) =>
      `${copy}. Bobarr will search automatically.`,
    futureEpisodesAuto:
      "Future episodes will be searched automatically when they air.",
    seasonComplete: "Season complete",
    seasonCompleteCopy: "Every monitored episode is ready in your library.",
    overviewReadyToConfigure: "Episode monitoring is ready to configure",
    overviewOpenSeason:
      "Open a season to see every episode, its air date, and what Bobarr is doing next.",
    monitoringIsOff: "Monitoring is off",
    existingFilesRemain: ({ count }: { count: number }) =>
      `${count} existing ${count === 1 ? "file remains" : "files remain"} in your library. Browse downloaded seasons below or choose what Bobarr should monitor.`,
    noAutomaticSearches:
      "No automatic searches will run. Choose what Bobarr should monitor or remove this title from the library.",
    futureSeasonMonitoringOn: "Future season monitoring is on",
    futureSeasonMonitoringCopy:
      "Downloaded seasons remain in your library without being searched again. Newly announced seasons will be added automatically.",
    monitoredEpisodesReady: ({
      ready,
      total,
    }: {
      ready: number;
      total: number;
    }) =>
      `${ready} of ${total} monitored ${total === 1 ? "episode" : "episodes"} ${ready === 1 ? "is" : "are"} ready`,
    noFileInLibrary: "No file in your library",
    monitoringCanSearch:
      "Bobarr is monitoring this movie and can search for a release.",
    monitoringOffTurnOn:
      "Automatic monitoring is off. Turn it on below if you want Bobarr to find this movie.",
    readyInLibrary: "Ready in your library",
    readyMonitoringOn:
      "Your organized copy is ready. Monitoring stays on in case Bobarr needs to acquire it again.",
    readyMonitoringOffMovie:
      "Your organized copy is ready. Bobarr will leave it alone unless you choose a one-time replacement.",
    workingOnRelease: ({ state }: { state: string }) => `${state} your movie`,
    workingOnReleaseCopy:
      "Bobarr is working on the selected release. Progress and destination are shown below.",
    acquisitionNeedsAttentionTitle: "Automatic acquisition needs attention",
    acquisitionNeedsAttentionCopy:
      "No ready file was created. Retry the search or choose a release yourself.",
    notMonitoredNoFile: "Not monitored and no file found",
    monitoringOnSummary: "On · Bobarr can reacquire this movie if needed",
    monitoringOffReplacement: "Off · one-time replacement is still available",
    monitoringOffNoSearch: "Off · Bobarr will not search",
    moreLikeThis: "More like this",
    currentCopy: "Current copy",
    acquisition: "Acquisition",
    movieFile: "Movie file",
    findThisMovie: "Find this movie",
    noOrganizedFile: "No organized file",
    searchOrRetry: "Search for a release or retry automatic acquisition.",
    turnOnMonitoring: "Turn on monitoring to let Bobarr acquire one.",
    movieDownloads: "Movie downloads",
    movieManagement: "Movie management",
    downloadStatus: "Download status",
    wantDifferentCopy: "Want a different copy?",
    chooseAnotherRelease: "Choose another release",
    replacementCopy:
      "Pick a one-time replacement without turning monitoring on. Your current library file stays in place until the new download is ready.",
    replaceActive: "Replace the active acquisition with a release you choose.",
    chooseReplacement: "Choose replacement…",
    chooseReleaseYourself: "Choose a release yourself",
    reviewJackett:
      "Review current Jackett results instead of waiting for the next automatic search.",
    searchReleasesManually: "Search releases manually…",
    confirmMovieTmdb:
      "Confirm this movie's TMDB match before searching for a release. Removal is still available.",
    libraryCleanup: "Library cleanup",
    removeThisMovie: "Remove this movie",
    removeRecordOrFile:
      "Remove only Bobarr's record, or also delete the organized movie file. You choose on the next screen.",
    removeMovieStopSearches:
      "Remove this movie from Bobarr and stop any future automatic searches.",
    offKeepCurrent: "Off — keep the current file only",
    offDoNotAcquire: "Off — do not acquire this movie",
    onSearchIfMissing: "On — search again if missing",
    replacementNoMonitoring:
      "A one-time replacement does not require monitoring.",
    confirmMovieTmdbMonitoring:
      "Confirm this movie's TMDB match before changing monitoring.",
    tvShowDetails: "TV show details",
    movieDetails: "Movie details",
    chooseReplacementFor: ({ title }: { title: string }) =>
      `Choose a replacement for ${title}`,
    findReleaseForTitle: ({ title }: { title: string }) =>
      `Find a release for ${title}`,
    titleFallback: "title",
    yearTvDescription: ({ year }: { year: string }) =>
      `${year} · TV series · Episode status and monitoring`,
    yearMovieDescription: ({ year }: { year: string }) =>
      `${year} · Movie · File, replacement, and monitoring`,
    removeFromLibraryQuestion: "Remove from library?",
    chooseWhatToRemove:
      "Choose whether to remove Bobarr's library record and which stored data should also be deleted.",
    removeTitleFromBobarr: "Remove this title from Bobarr",
    filesStayUnlessDeleted:
      "Files stay on disk unless you select deletion below. A future library scan may find the title again.",
    deleteOrganizedFiles: "Delete organized library files",
    deletesFilesFrom: ({
      files,
      size,
      folder,
    }: {
      files: string;
      size: string;
      folder: string;
    }) => `Deletes ${files}${size} from your ${folder} folder.`,
    sizeInParens: ({ size }: { size: string }) => ` (${size})`,
    removesFilesFromFolder:
      "Removes files from your movies or television folder.",
    moviesFolder: "movies",
    televisionFolder: "television",
    removeTorrent: "Remove torrent from Transmission",
    removeTorrentHint: "Stops seeding and removes its torrent record.",
    deleteOriginalData: "Delete original download data",
    cannotBeUndone: "This cannot be undone.",
    willRemoveTitleAndFiles:
      "Bobarr will remove this title and its organized library files. This cannot be undone.",
    remainsUnmonitored:
      "The title remains visible as unmonitored unless its library record is removed.",
    confirmRemoval: "Confirm removal",
    selectItemFirst: "Select a library item first.",
    noMatchingTitles: "No matching titles",
    changeFilters: "Change your filters to see more of your library.",
    downloadMovie: "Download movie",
    downloadNamed: ({ name }: { name: string }) => `Download ${name}`,
    episode: "Episode",
    recentlyAddedDescription: ({ label }: { label: string }) =>
      `The newest ${label} to land in your library.`,
    recentlyDownloadedEpisodes: "Recently downloaded episodes",
    recentlyDownloadedEpisodesCopy:
      "Fresh episode files that just landed in your library.",
    loadingRecentlyDownloaded: "Loading recently downloaded episodes…",
    needsAttentionShelf: "Needs attention",
    needsAttentionShelfCopy:
      "Missing or failed acquisitions that still need a release.",
    highlyRated: "Highly rated",
    highlyRatedCopy: ({ label }: { label: string }) =>
      `Your library ${label} rated 7.0 and above.`,
    genreShelfCopy: ({ genre, label }: { genre: string; label: string }) =>
      `A shelf drawn from the ${genre} ${label} you already keep.`,
    loadingNamed: ({ name }: { name: string }) => `Loading ${name}…`,
    openSeriesEpisode: ({
      series,
      code,
      episode,
    }: {
      series: string;
      code: string;
      episode: string;
    }) => `Open ${series}, ${code} ${episode}`,
    moviesReadyToGrow: "Your movie library is ready to grow",
    showsReadyToGrow: "Your show library is ready to grow",
    emptyGuidance:
      "Start with files you already have, or let Bobarr find something new.",
    scanExistingMovies: "Scan existing movies",
    scanExistingShows: "Scan existing shows",
    getSuggestions: "Get suggestions",
    browseDiscover: "Browse Discover",
    needsAttentionStrip: "Library needs attention",
    failedCount: ({ count }: { count: number }) => `${count} failed`,
    missingCount: ({ count }: { count: number }) => `${count} missing`,
    showFailed: "Show failed",
    showMissing: "Show missing",
    moviesLabel: "movies",
    showsLabel: "shows",
  },
  activity: {
    eyebrow: "Operations",
    title: "Activity",
    description:
      "Downloads, acquisition work, and system events without leaving Bobarr.",
    view: "Activity view",
    downloads: "Downloads",
    jobs: "Jobs",
    history: "History",
    downloadStatus: "Download status",
    active: "Active",
    completed: "Completed",
    all: "All",
    jobType: "Job type",
    allJobTypes: "All job types",
    updatingJobs: "Updating jobs…",
    runMaintenance: "Run maintenance now",
    runMaintenanceHint:
      "Queue a scan or maintenance task and follow its progress below.",
    task: "Task",
    runJob: "Run job",
    jobsPagination: "Jobs pagination",
    previous: "Previous",
    next: "Next",
    pageRange: ({
      from,
      to,
      total,
    }: {
      from: number;
      to: number;
      total: number;
    }) => `${from}–${to} of ${total}`,
    contactingTransmission: "Contacting Transmission…",
    addDownload: "Add a download",
    addDownloadDescription:
      "Only magnets and capped torrent metainfo files are accepted.",
    downloadSource: "Download source",
    magnetUri: "Magnet URI",
    noJobsTitle: "No background work",
    noJobsDescription:
      "Scheduled searches, scans, and organization jobs will appear here.",
    noHistoryTitle: "Nothing to report yet",
    noHistoryDescription:
      "Acquisition, library, and service events will build a readable history here.",
    removeDownload: "Remove download?",
    addDownloadAction: "Add download",
    magnetLink: "Magnet link",
    torrentFile: ".torrent file",
    magnetPlaceholder: "magnet:?xt=urn:btih:…",
    chooseTorrent: "Choose a .torrent file",
    torrentHint: "Metainfo only · size limit is enforced by Bobarr",
    invalidMagnet: "Enter a valid magnet URI.",
    chooseTorrentFirst: "Choose a .torrent file first.",
    selectDownloadFirst: "Select a download first.",
    pause: "Pause",
    resume: "Resume",
    retry: "Retry",
    remove: "Remove",
    chooseFiles: "Choose files",
    priority: ({ value }: { value: string }) => `${value} priority`,
    nothingDownloading: "Nothing is downloading",
    noCompletedDownloads: "No completed downloads",
    noDownloadsYet: "No downloads yet",
    finishedDownloads:
      "Finished downloads will appear here when they complete.",
    automaticDownloads:
      "Automatic acquisitions and manually added torrents will appear here.",
    loadOlderDownloads: "Load older downloads",
    downloadsWithCount: ({ count }: { count: number }) =>
      count ? `Downloads · ${count}` : "Downloads",
    scheduled: ({ when }: { when: string }) => `Scheduled ${when}`,
    attemptOf: ({ attempts, max }: { attempts: number; max: number }) =>
      `Attempt ${attempts} of ${max}`,
    of: ({ from, to }: { from: number | string; to: number | string }) =>
      `${from} of ${to}`,
    jobDetails: "Job details",
    jobDetailsDescription:
      "Persisted execution state and lifecycle log for this background job.",
    loadingJobLog: "Loading job log…",
    jobStatus: "Status",
    attempts: "Attempts",
    scheduledAt: "Scheduled",
    jobId: "Job ID",
    executionLog: "Execution log",
    emptyJobLog: "No lifecycle entries were recorded for this older job.",
    jobPayload: "Job payload",
    jobQueued: ({ kind }: { kind: string }) => `${kind} queued.`,
    removeDownloadDescription:
      "The torrent can be removed while keeping its downloaded data. If it is linked to library media, automatic monitoring stops for that movie, season, or episode so Bobarr will not immediately add it again.",
    alsoDeleteData: "Also delete downloaded data",
    alsoDeleteDataHint:
      "This is permanent and may affect organized files when using move or symlink.",
    keepDownload: "Keep download",
    jobKinds: {
      "media.acquire.v1": "Media acquisition",
      "acquisition.add-torrent": "Add torrent",
      "acquisition.organize-download": "Organize download",
      "library.scan.v1": "Library scan",
      "maintenance.reconcile.v1": "Reconcile services",
      "maintenance.search-missing.v1": "Search missing media",
      "maintenance.refresh-metadata.v1": "Refresh metadata",
      "maintenance.backup.v1": "Backup",
      "maintenance.cleanup.v1": "Cleanup",
    },
  },
  settings: {
    eyebrow: "Configuration",
    title: "Settings",
    description:
      "Connections, acquisition preferences, storage, and maintenance.",
    sections: "Settings sections",
    connections: "Connections",
    preferences: "Preferences",
    storage: "Storage",
    schedules: "Schedules",
    maintenance: "Maintenance",
    security: "Security",
    people: "People",
    metadataLanguage: "Metadata language",
    metadataLanguageHint:
      "ISO 639-1 catalog language for titles. This is not the UI language.",
    region: "Region",
    regionHint: "Two-letter country code",
    isoLanguage: "Enter an ISO language code.",
    twoLetterRegion: "Use a two-letter region code.",
    validJackettUrl: "Enter a valid Jackett URL.",
    validTransmissionUrl: "Enter a valid Transmission URL.",
    addQuality: "Add at least one quality.",
    absolutePath: "Use an absolute path.",
    loading: "Loading settings…",
    connectionsBody:
      "Credentials are encrypted at rest and are never returned in full.",
    preferencesTitle: "Acquisition preferences",
    preferencesBody:
      "Hard limits exclude releases; term and quality rules determine ranking.",
    storageTitle: "Storage & organization",
    storageBody: "All paths must live under the mounted media root.",
    schedulesBody: "Standard five-field cron expressions evaluated in UTC.",
    maintenanceBody:
      "Back up application state before upgrades or storage changes.",
    securityTitle: "Sign-in security",
    securityBody: "Control temporary protection after password failures.",
    tmdbApiKey: "TMDB API key",
    omdbApiKey: "OMDb API key",
    jackettUrl: "Jackett URL",
    jackettUrlHint:
      "Use the Jackett instance URL; reverse-proxy, dashboard, and copied Torznab URLs are normalized safely.",
    jackettApiKey: "Jackett API key",
    transmissionRpcUrl: "Transmission RPC URL",
    transmissionUsername: "Transmission username",
    transmissionPassword: "Transmission password",
    keepSecret: "Leave unchanged to keep current secret",
    minimumSeeders: "Minimum seeders",
    minimumSizeMb: "Minimum size (MB)",
    maximumSizeMb: "Maximum size (MB)",
    noMinimum: "No minimum",
    noMaximum: "No maximum",
    qualityOrder: "Quality order",
    qualityOrderHint: "Highest priority first, separated by commas.",
    downloadsPath: "Downloads path",
    moviesPath: "Movies path",
    televisionPath: "Television path",
    organizationStrategy: "Organization strategy",
    organizationHint: "Hardlinks preserve seeding without duplicating data.",
    hardlink: "Hardlink (recommended)",
    symlink: "Symbolic link",
    copy: "Copy",
    move: "Move",
    validatePaths: "Validate paths",
    searchMissing: "Search missing media",
    refreshMetadata: "Refresh metadata",
    scanLibrary: "Scan library",
    createBackup: "Create backup",
    backupsToRetain: "Backups to retain",
    createBackupNow: "Create a backup now",
    createBackupHint:
      "A consistent SQLite snapshot is retained in your config volume.",
    backUp: "Back up",
    stageRestore: "Stage a database restore",
    stageRestoreHint:
      "The upload is verified now and applied only after a Bobarr restart.",
    offlinePasswordReset: "Offline password reset",
    offlinePasswordResetHint:
      "Use the documented CLI command on the Bobarr host.",
    hostOnly: "Host only",
    stagedRestore: ({ size }: { size: string }) =>
      `A restore is staged for the next restart. Its verified image is ${size}.`,
    verifiedBackups: "Verified application backups",
    noVerifiedBackups: "No verified backups yet.",
    checkingBackups: "Checking backups…",
    schemaVersion: ({ version, name }: { version: number; name: string }) =>
      `Schema ${version} · ${name}`,
    temporarilyLock: "Temporarily lock sign-in",
    temporarilyLockHint:
      "Block new sign-ins for a short time after repeated password failures.",
    resetSignInLock: "Reset sign-in lock",
    resetSignInLockHint:
      "Clear the current lock and all recorded failed attempts.",
    thisSession: "This session",
    thisSessionHint:
      "Sign out this browser without interrupting background work.",
    unsavedChanges: "You have unsaved changes.",
    settingsUpToDate: "Settings are up to date.",
    saveSettings: "Save settings",
    stageRestoreTitle: "Stage database restore",
    stageRestoreDescription:
      "This changes application state on the next restart.",
    restoreWarning:
      "Downloads, library records, settings, administrator sessions, and encrypted secrets will return to the backup state. Keep the same master key or connector secrets cannot be decrypted.",
    selectedFile: ({ name, size }: { name: string; size: string }) =>
      `Selected: ${name} (${size})`,
    typeRestoreToConfirm: 'Type "RESTORE" to confirm',
    verifyAndStage: "Verify and stage restore",
    savedSecurely: "Settings saved securely.",
    connectionResult: ({
      label,
      healthy,
    }: {
      label: string;
      healthy: boolean;
    }) => `${label} connection ${healthy ? "is ready" : "needs attention"}.`,
    storageAccessible: "Storage paths are accessible.",
    storageValidationFailed: "Storage validation failed.",
    backupCreated: "Backup created and verified.",
    restoreStaged:
      "Restore staged. Restart Bobarr to apply it; a rollback backup will be created first.",
    loginLockReset: "Temporary sign-in lock and failures reset.",
  },
  people: {
    title: "People",
    description:
      "Invite friends as users. Promote someone when they should change settings too.",
    inviteSomeone: "Invite someone",
    copyInvite: "Copy invite link",
    openInvite: "Open invite",
    makeAdmin: "Make admin",
    makeUser: "Make user",
    expires: ({ date }: { date: string }) => `Expires ${date}`,
    inviteCreated: "Invite link created. Copy it now; it is shown only once.",
    inviteRevoked: "Invite revoked.",
    accountDeleted: "Account deleted.",
    nowAdmin: ({ username }: { username: string }) =>
      `${username} is now an administrator.`,
    nowUser: ({ username }: { username: string }) =>
      `${username} is now a user.`,
    rankAdmin: "admin",
    rankUser: "user",
  },
  catalog: {
    viewTitle: ({ title }: { title: string }) => `View ${title}`,
    tracked: "Tracked",
    yearUnavailable: "Year unavailable",
    yearTba: "Year TBA",
    externalRatings: "External ratings",
    imdbRating: ({ value, scale }: { value: string; scale: number }) =>
      `IMDb rating ${value} out of ${scale}`,
    tomatoesRating: ({ value }: { value: number }) =>
      `Rotten Tomatoes rating ${value} percent`,
    topCast: "Top cast",
    actors: "Actors",
    discoverWith: ({ name }: { name: string }) =>
      `Discover movies with ${name}`,
    noSynopsis: "No synopsis is available yet.",
    watchTrailer: "Watch trailer",
    trailerFor: ({ title }: { title: string }) => `${title} trailer`,
    addToLibrary: "Add to library",
    openInLibrary: "Open in library",
    keepBrowsing: "Keep browsing",
    chooseSeasons: "Choose seasons",
    chooseSeasonsHint: "Only selected seasons are searched automatically.",
    selectAll: "Select all",
    latest: "Latest",
    loadingYear: "Loading year…",
    monitorFutureSeasons: "Monitor future seasons",
    monitorFutureSeasonsHint:
      "Opt in to newly announced seasons during metadata refresh.",
    manualSearch: "Manual search",
    hideReleases: "Hide releases",
    addAndSearchManually: "Add & search manually",
    addBeforeSearch: "Add this title to your library before searching releases",
    titleDetails: "Title details",
    addedManual:
      "Added to your library without starting a download. Choose a release below when you are ready.",
    addedAutomatic:
      "Added to your library. Bobarr will look for an eligible release.",
    chooseManualFirst:
      "Choose Add & search manually to select a release before any download starts.",
    addBeforeGrab:
      "Add this title to your library before searching or grabbing a release.",
    seasonForManualSearch: "Season for manual search",
    attachesToSeason:
      "Bobarr attaches the selected release to this monitored season.",
    selectTitleFirst: "Select a catalog title first.",
    rottenTomatoes: "Rotten Tomatoes",
    imdb: "IMDb",
  },
  releases: {
    noReleasesTitle: "No releases found",
    noReleasesDescription:
      "Try again later or adjust your release profile in Settings.",
    searching: "Searching indexers…",
    exclusionReasons: "Exclusion reasons",
    jackettQuery: "Jackett search query",
    searchJackett: "Search Jackett",
    grab: "Grab",
    replace: "Replace",
    excluded: "Excluded",
    releaseCandidates: "Release candidates",
    generatingQuery: "Generating a query…",
    queryHint:
      "Edit the generated query and search again. Media matching and candidate binding still use the selected title and episode.",
    score: ({ value }: { value: number }) => `Score ${value}`,
    seeders: ({ count }: { count: number }) => `${count} seeders`,
    replacementUnbound: "This replacement is no longer bound to library media.",
    replacementWarning:
      "Choosing a candidate starts an explicit replacement. Any active Bobarr download for this item is stopped and its incomplete data is removed; an organized library file remains until its replacement is ready.",
    queuedNotice: ({
      kind,
      title,
    }: {
      kind: "replacement" | "release";
      title: string;
    }) =>
      `${kind === "replacement" ? "Replacement" : "Release"} queued: ${title}. Track it in Activity.`,
    replacementKind: "Replacement",
    releaseKind: "Release",
  },
  scanReview: {
    needsMatch: "Needs a match",
    importTitle: "Import this title",
    searchTmdb: "Search TMDB manually",
    noDescription: "No description available.",
    invalidTmdbUrl: "Invalid TMDB URL.",
    minSearch: "Enter at least 2 characters to search TMDB.",
    searchFailed: "TMDB search failed.",
    manualSearch: "Manual TMDB search",
    searchHint:
      "Try another title, or paste a TMDB URL or numeric ID for an exact match.",
    tmdbTitle: "TMDB title",
    placeholder: "Title, TMDB URL, or ID…",
    noTitlesFound: "No TMDB titles found. Try a different search.",
    searchResults: "TMDB search results",
    candidates: "TMDB candidates",
    kindMismatch: ({ expected, found }: { expected: string; found: string }) =>
      `This ${expected} review cannot be matched to a ${found} URL.`,
    filesLine: ({ year, files }: { year: string; files: string }) =>
      `${year} · ${files}`,
    foundUnder: ({ path }: { path: string }) => `Found under ${path}`,
    loadFailed: ({ message }: { message: string }) =>
      `Could not load scan reviews. ${message}`,
    matchReview: "Match review",
    chooseTitle: "Choose the right TMDB title",
    chooseTitleBody:
      "Bobarr found ambiguous folders and will not guess. Confirm a match to import the recorded files.",
    pending: ({ count }: { count: number }) => `${count} pending`,
  },
  terms: {
    required: "Required terms",
    requiredHint:
      "Every comma-separated term must be present or the release is excluded.",
    preferred: "Preferred terms",
    preferredHint: "Comma-separated terms that raise a release score.",
    rejected: "Rejected terms",
    rejectedHint: "Comma-separated terms that make a release ineligible.",
  },
};

export type Messages = typeof en;
