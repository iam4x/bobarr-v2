import type { Messages } from "./en";

export const fr = {
  locale: {
    label: "Langue",
    switch: "Langue de l’interface",
  },
  common: {
    loading: "Chargement",
    loadingEllipsis: "Chargement…",
    tryAgain: "Réessayer",
    closeDialog: "Fermer la boîte de dialogue",
    progress: "Progression",
    loadingTitles: "Chargement des titres",
    requestId: ({ id }: { id: string }) => `Requête ${id}`,
    somethingWentWrong: "Une erreur s’est produite",
    requestFailed: "La requête n’a pas pu aboutir.",
    cancel: "Annuler",
    back: "Retour",
    refresh: "Actualiser",
    loadMore: "Charger plus",
    download: "Télécharger",
    test: "Tester",
    delete: "Supprimer",
    revoke: "Révoquer",
    dismiss: "Ignorer",
    save: "Enregistrer",
    chooseFile: "Choisir un fichier",
    optional: "Facultatif",
    configured: "Configuré",
    notConfigured: "Non configuré",
    calculating: "Calcul en cours",
    yearUnknown: "Année inconnue",
    genres: "Genres",
    integration: "Intégration",
    files: ({ count }: { count: number }) =>
      count === 1 ? "1 fichier" : `${count} fichiers`,
    bytesOf: ({ from, to }: { from: string; to: string }) =>
      `${from} sur ${to}`,
    eta: ({ value }: { value: string }) => `ETA ${value}`,
    ratingAria: ({
      source,
      value,
      scale,
    }: {
      source: string;
      value: string;
      scale: number;
    }) => `Note ${source} ${value} sur ${scale}`,
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
    }) => `Note ${source} ${value} sur ${scale}, ${votes} votes`,
    downloadProgress: ({ title }: { title: string }) =>
      `Progression du téléchargement de ${title}`,
    speed: "Vitesse",
  },
  status: {
    searching: "Recherche",
    queued: "En file",
    downloading: "Téléchargement",
    organizing: "Classement",
    available: "Disponible",
    missing: "Manquant",
    failed: "Échec",
    unmonitored: "Non suivi",
    paused: "En pause",
    seeding: "Partage",
    checking: "Vérification",
    completed: "Terminé",
    pending: "En attente",
    running: "En cours",
    retrying: "Nouvelle tentative",
    cancelled: "Annulé",
  },
  dates: {
    unknown: "Date inconnue",
    tba: "À venir",
  },
  routeError: {
    notFoundTitle: "Cette page s’est égarée",
    errorTitle: "Bobarr a rencontré un problème",
    notFoundDescription: "La page demandée n’existe pas.",
    loadFailed: "Impossible de charger la page.",
    backToDiscover: "Retour à Découvrir",
  },
  nav: {
    main: "Navigation principale",
    mobile: "Navigation mobile",
    browse: "Parcourir",
    library: "Bibliothèque",
    system: "Système",
    discover: "Découvrir",
    search: "Recherche",
    suggestions: "Suggestions",
    movies: "Films",
    shows: "Séries",
    calendar: "Calendrier",
    activity: "Activité",
    settings: "Réglages",
    account: "Compte",
    more: "Plus",
    moreTitle: "Plus dans Bobarr",
    moreEyebrow: "Navigation",
    closeMenu: "Fermer le menu",
    signOut: "Déconnexion",
    version: "Bobarr v2",
    statusReady: "Tous les services sont prêts",
    statusDegraded: "Service dégradé",
    statusUnavailable: "Service indisponible",
    degraded: "Dégradé",
    offline: "Bobarr est hors ligne. Nouvelle tentative de connexion en cours.",
    warmingUp: "Préparation de votre bibliothèque…",
  },
  auth: {
    about: "À propos de Bobarr",
    privateByDesign: "Privé par conception",
    storyTitleLine1: "Votre liste à voir,",
    storyTitleLine2: "automatisée en silence.",
    storyBody:
      "Trouvez un titre. Bobarr s’occupe de la recherche, du téléchargement et du classement, sur une infrastructure que vous possédez.",
    featureJackett: "Recherche de releases via Jackett",
    featureTransmission: "Transmission reste derrière l’API",
    featureOrganize: "Fichiers classés sans interrompre le seeding",
    footer: "Bobarr s’exécute entièrement sur votre serveur.",
    username: "Nom d’utilisateur",
    password: "Mot de passe",
    confirmPassword: "Confirmer le mot de passe",
    loginEyebrow: "Bon retour",
    loginTitle: "Connexion à Bobarr",
    loginDescription:
      "Utilisez votre nom d’utilisateur et votre mot de passe Bobarr.",
    signIn: "Connexion",
    lostAccessLead: "Accès perdu ?",
    lostAccessRest:
      " Réinitialisez le mot de passe administrateur depuis l’hôte Bobarr.",
    enterUsername: "Saisissez votre nom d’utilisateur.",
    enterPassword: "Saisissez votre mot de passe.",
    setupEyebrow: "Première utilisation",
    setupTitle: "Faites de Bobarr le vôtre",
    setupDescription:
      "Créez le compte administrateur. Vous pourrez configurer les services ensuite.",
    adminUsername: "Nom d’utilisateur administrateur",
    passwordHint: "Tout mot de passe non vide",
    createAdministrator: "Créer l’administrateur",
    checkingServer: "Vérification du serveur…",
    setupHelp:
      "Votre mot de passe est haché avec Argon2id. Les secrets des connecteurs sont chiffrés séparément.",
    minUsername: "Utilisez au moins 3 caractères.",
    enterAPassword: "Saisissez un mot de passe.",
    passwordsMismatch: "Les mots de passe ne correspondent pas.",
    inviteEyebrow: "Invitation",
    inviteInvalidTitle: "Cette invitation n’est pas valable",
    inviteInvalidDescription:
      "Demandez un nouveau lien à un administrateur. Les invitations utilisées ou expirées ne peuvent pas être réutilisées.",
    goToSignIn: "Aller à la connexion",
    checkingInvite: "Vérification de l’invitation…",
    invitedEyebrow: "Vous êtes invité",
    inviteTitle: "Créez votre compte Bobarr",
    inviteDescription:
      "Choisissez un nom d’utilisateur et un mot de passe. Vous partagerez cette bibliothèque avec les personnes déjà présentes.",
    join: "Rejoindre Bobarr",
    unavailableEyebrow: "Serveur indisponible",
    unavailableTitle: "Bobarr ne répond pas",
    unavailableDescription:
      "Vérifiez que le conteneur est en cours d’exécution, puis actualisez cette page.",
  },
  account: {
    eyebrow: "Compte",
    title: "Votre connexion",
    description:
      "Modifiez le nom d’utilisateur et le mot de passe de ce compte.",
    languageTitle: "Langue",
    languageDescription:
      "Choisissez la langue des menus et des libellés de Bobarr. Ce n’est pas la langue des métadonnées utilisée pour les titres.",
    username: "Nom d’utilisateur",
    newPassword: "Nouveau mot de passe",
    confirmNewPassword: "Confirmer le nouveau mot de passe",
    passwordHint: "Laissez vide pour conserver le mot de passe actuel.",
    updated: "Identifiants mis à jour.",
    updateLogin: "Mettre à jour la connexion",
    minUsername: "Utilisez au moins 3 caractères.",
    usernameCharset:
      "Utilisez des lettres, des chiffres, des points, des tirets bas ou des tirets.",
    passwordsMismatch: "Les mots de passe ne correspondent pas.",
  },
  kind: {
    movie: "Film",
    series: "Série",
    all: "Tout",
    everything: "Tout",
    shows: "Séries",
    tvShow: "Série TV",
    tvShows: "Séries TV",
  },
  search: {
    eyebrow: "Catalogue TMDB",
    title: "Trouvez votre prochain coup de cœur",
    description:
      "Cherchez des films et des séries, puis laissez Bobarr s’occuper du reste.",
    inputLabel: "Rechercher des films et des séries",
    placeholder: "Rechercher des films et des séries…",
    clear: "Effacer la recherche",
    submit: "Rechercher",
    mediaType: "Type de média",
    promptTitle: "Que cherchez-vous ?",
    promptBody:
      "Recherchez par titre. Les résultats sont associés aux métadonnées TMDB avant l’acquisition.",
    noMatchesTitle: "Aucun résultat",
    noMatches: ({ query }: { query: string }) =>
      `Aucun résultat pour « ${query} ». Vérifiez l’orthographe ou essayez un autre titre.`,
    results: "Résultats",
    titleCount: ({ count }: { count: number }) =>
      count === 1 ? "1 titre" : `${count} titres`,
  },
  discover: {
    eyebrow: "Explorer",
    title: "Découvrez quelque chose de remarquable",
    description:
      "Recherchez, recevez des suggestions ou parcourez les titres populaires et acclamés au même endroit.",
    mediaType: "Type de média",
    advancedSearch: "Recherche avancée",
    suggestionsLink: "Suggestions",
    hideOwned: "Masquer les titres possédés",
    showOwned: "Afficher les titres possédés",
    filters: "Filtres",
    refineEyebrow: "Affiner la découverte",
    refineTitle: "Trouvez votre prochain visionnage",
    refineDescription: "Empilez les filtres, puis appliquez-les ensemble.",
    highestRatedVoteHint:
      "Les mieux notés utilisent 200 votes minimum par défaut.",
    defaultVotes: ({ count }: { count: number }) =>
      `Par défaut · ${count.toLocaleString("fr-FR")} votes et plus`,
    genres: "Genres",
    matchAnyGenre: "Correspond à n’importe quel genre sélectionné.",
    loadingGenres: "Chargement des genres…",
    genresUnavailable: "Les genres sont temporairement indisponibles.",
    originAndLanguage: "Origine et langue",
    originHint: "Filtrez le pays d’origine et la langue originale.",
    configUnavailable: "Certains choix TMDB sont temporairement indisponibles.",
    anyCountry: "Tous les pays",
    anyLanguage: "Toutes les langues",
    releaseWindow: "Fenêtre de sortie",
    releaseWindowHint: "Utilisez une année exacte ou une plage de dates.",
    lengthAndQuality: "Durée et qualité",
    lengthHint: "Restreignez le temps à y consacrer et la note du public.",
    applied: "Appliqués",
    reset: "Réinitialiser",
    applyFilters: "Appliquer les filtres",
    clearAll: "Tout effacer",
    noActiveFilters: "Aucun filtre actif",
    activeFilters: ({ count }: { count: number }) =>
      count === 1 ? "1 filtre actif" : `${count} filtres actifs`,
    removeFilter: ({ label }: { label: string }) =>
      `Retirer le filtre ${label}`,
    pageOf: ({ page, total }: { page: number; total: number }) =>
      `Page ${page} sur ${total}`,
    yearRange: "L’année doit être un entier entre 1874 et 2200.",
    startDateRange:
      "La date de début doit être entre 1874-01-01 et 2200-12-31.",
    endDateRange: "La date de fin doit être entre 1874-01-01 et 2200-12-31.",
    runtimeOrder:
      "La durée maximale doit être au moins égale à la durée minimale.",
    dateOrder:
      "La date de fin doit être postérieure ou égale à la date de début.",
    closeFilters: "Fermer les filtres",
    sortBy: "Trier par",
    minimumVotes: "Votes minimum",
    originCountry: "Pays d’origine",
    originalLanguage: "Langue originale",
    exactYear: "Année exacte",
    yearPlaceholder: "ex. 2024",
    dateFrom: "Du",
    dateTo: "Au",
    minimumLength: "Durée minimale",
    maximumLength: "Durée maximale",
    minimumRating: "Note minimale",
    appliedFilters: "Filtres appliqués",
    emptyTitle: "Aucun titre ne correspond à ces filtres",
    emptyDescription:
      "Retirez un filtre ou essayez une combinaison plus large.",
    pages: "Pages Découvrir",
    previousPage: "Page précédente",
    nextPage: "Page suivante",
    anyLength: "Toute durée",
    minutes: ({ count }: { count: number }) => `${count} minutes`,
    hours: ({ count }: { count: number }) =>
      count === 1 ? "1 heure" : `${count} heures`,
    hoursAndHalf: ({ count }: { count: number }) => `${count} h 30`,
    anyNumber: "N’importe quel nombre",
    noMinimum: "Pas de minimum",
    votes: ({ count }: { count: number }) =>
      `${count.toLocaleString("fr-FR")} votes et plus`,
    anyRating: "Toute note",
    ratingAndAbove: ({ value }: { value: string }) => `${value} et plus`,
    showingOwned: "Affiche les titres déjà possédés",
    actor: ({ name }: { name: string }) => `Acteur : ${name}`,
    tmdbPerson: ({ id }: { id: number }) => `Personne TMDB ${id}`,
    genreFallback: ({ id }: { id: number }) => `Genre ${id}`,
    languagePrefix: ({ name }: { name: string }) => `Langue : ${name}`,
    yearPrefix: ({ year }: { year: string }) => `Année : ${year}`,
    until: ({ date }: { date: string }) => `Jusqu’au ${date}`,
    fromDate: ({ date }: { date: string }) => `À partir du ${date}`,
    dateRange: ({ from, to }: { from: string; to: string }) =>
      `Dates : ${from} – ${to}`,
    lengthRange: ({ lower, upper }: { lower: string; upper: string }) =>
      `Durée : ${lower} – ${upper}`,
    minutesShort: ({ count }: { count: string }) => `${count} min`,
    any: "Indifférent",
    rated: ({ value }: { value: string }) => `Note ${value}+`,
    sort: {
      "popularity.asc": "Moins populaires",
      "popularity.desc": "Les plus populaires",
      "vote_average.asc": "Moins bien notés",
      "vote_average.desc": "Mieux notés",
      "vote_count.asc": "Moins de votes",
      "vote_count.desc": "Les plus votés",
      "release_date.asc": "Les plus anciens",
      "release_date.desc": "Les plus récents",
      "primary_release_date.asc": "Les plus anciens",
      "primary_release_date.desc": "Les plus récents",
      "first_air_date.asc": "Les plus anciens",
      "first_air_date.desc": "Les plus récents",
      "title.asc": "Titre A–Z",
      "title.desc": "Titre Z–A",
      "name.asc": "Titre A–Z",
      "name.desc": "Titre Z–A",
      "original_title.asc": "Titre original A–Z",
      "original_title.desc": "Titre original Z–A",
      "original_name.asc": "Titre original A–Z",
      "original_name.desc": "Titre original Z–A",
      "revenue.asc": "Moins de recettes",
      "revenue.desc": "Plus de recettes",
    },
  },
  suggestions: {
    eyebrow: "Depuis votre bibliothèque",
    title: "Suggestions justifiées",
    type: "Type de suggestion",
    loadingShelves: "Chargement des étagères de suggestions",
    loadError: "Impossible de charger les suggestions",
    emptyOtherTab:
      "Il y a des suggestions dans un autre onglet, ou vous pouvez explorer le catalogue pour un autre point de départ.",
    scrollLeft: ({ title }: { title: string }) =>
      `Faire défiler les suggestions de ${title} vers la gauche`,
    scrollRight: ({ title }: { title: string }) =>
      `Faire défiler les suggestions de ${title} vers la droite`,
    viewItem: ({ title }: { title: string }) => `Voir la suggestion ${title}`,
    newMix: "Nouveau mélange",
    basedOnLibrary: "D’après votre bibliothèque",
    inspiredByLibrary: "Inspiré par votre bibliothèque",
    moreBasedOnLibrary: ({ kind }: { kind: string }) =>
      `Plus de ${kind} d’après votre bibliothèque`,
    becauseInLibrary: ({ title }: { title: string }) =>
      `Parce que « ${title} » est dans votre bibliothèque`,
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
      `Faire défiler les suggestions inspirées par ${title}`,
    toolbarSummary: ({
      suggestions,
      titles,
    }: {
      suggestions: string;
      titles: string;
    }) => `${suggestions} de ${titles}`,
    libraryTitleCount: ({ count }: { count: number }) =>
      count === 1
        ? "1 titre de bibliothèque"
        : `${count} titres de bibliothèque`,
    defaultDescription:
      "Des recommandations organisées autour des films et séries que vous avez déjà choisis.",
    personalizedDescription:
      "Chaque étagère part d’un film ou d’une série déjà dans votre bibliothèque.",
    emptyLibraryDescription:
      "Ajoutez quelques films ou séries et Bobarr construira des étagères de recommandations autour d’eux.",
    shelvesWaiting: "Vos étagères de recommandations attendent",
    noFreshMix: "Pas de suggestions nouvelles dans ce mélange",
    addStartingPoint:
      "Ajoutez un film ou une série à votre bibliothèque et Bobarr s’en servira comme point de départ pour de nouvelles suggestions.",
    tryAnotherMix:
      "Explorez le catalogue pour quelque chose de nouveau, ou essayez un autre mélange lorsqu’il sera disponible.",
    exploreTitles: "Explorer les titres",
    noKindShelves: ({ kind }: { kind: string }) =>
      `Aucune étagère ${kind} dans ce mélange`,
    viewAll: "Voir toutes les suggestions",
    forYou: "Pour vous",
    fromYourLibrary: "Suggestions depuis votre bibliothèque",
    quickMix: "Un aperçu rapide avant de plonger dans les filtres.",
    seeAll: "Tout voir",
    searchCatalog: "Rechercher dans le catalogue…",
    searchCatalogLabel: "Rechercher dans le catalogue",
  },
  calendar: {
    eyebrow: "Programme",
    title: "Bientôt à l’écran",
    description: "Dates de sortie et prochains épisodes de chaque titre suivi.",
    loading: "Chargement de votre calendrier…",
    emptyTitle: "Votre calendrier est vide",
    emptyDescription:
      "Les films et épisodes à venir apparaîtront ici une fois un titre suivi.",
    today: "Aujourd’hui",
    releaseCount: ({ count }: { count: number }) =>
      count === 1 ? "1 sortie" : `${count} sorties`,
  },
  library: {
    eyebrow: "Votre bibliothèque",
    moviesDescription:
      "Parcourez, filtrez et suivez chaque acquisition de film.",
    showsDescription:
      "Parcourez les séries, suivez les nouveaux épisodes et gardez le suivi à jour.",
    scan: "Analyser la bibliothèque",
    type: "Type de bibliothèque",
    summary: "Résumé de la bibliothèque",
    filterPlaceholder: "Filtrer votre bibliothèque…",
    availability: "Disponibilité",
    browseFilters: "Filtres de parcours",
    sort: "Tri",
    genre: "Genre",
    year: "Année",
    rating: "Note",
    quality: "Qualité",
    grid: "Bibliothèque",
    recentlyAdded: "Ajouts récents",
    sortRecentlyAdded: "Ajoutés récemment",
    sortOldestAdded: "Ajoutés en premier",
    sortRecentlyUpdated: "Mis à jour récemment",
    sortTitleAsc: "Titre A–Z",
    sortTitleDesc: "Titre Z–A",
    sortNewestYear: "Année la plus récente",
    sortOldestYear: "Année la plus ancienne",
    sortHighestRated: "Mieux notés",
    sortLowestRated: "Moins bien notés",
    anyQuality: "Toute qualité",
    anyRating: "Toute note",
    anyGenre: "Tous les genres",
    anyYear: "Toutes les années",
    available: "Disponible",
    missing: "Manquant",
    active: "En cours",
    failed: "Échec",
    all: "Tout",
    filterMovies: "Filtrer les films",
    filterShows: "Filtrer les séries",
    clearFilters: "Effacer les filtres",
    scanQueued:
      "Analyse de la bibliothèque mise en file. Suivez sa progression dans Activité.",
    ratingMin: ({ value }: { value: string }) => `${value}+`,
    openDetails: ({ title }: { title: string }) =>
      `Ouvrir les détails de ${title}`,
    downloaded: "Téléchargés",
    total: "Total",
    inProgress: "En cours",
    airedAndMissing: "Diffusés et manquants",
    upcomingTba: "À venir / TBA",
    downloadFolder: "Dossier de téléchargement",
    downloadingTo: "Téléchargement vers",
    inLibrary: "Dans la bibliothèque",
    episodesReady: ({ ready, total }: { ready: number; total: number }) =>
      `${ready} sur ${total} épisodes prêts`,
    episodeAvailability: ({ title }: { title: string }) =>
      `Disponibilité des épisodes de ${title}`,
    nextEpisode: ({ date }: { date: string }) => `Prochain épisode ${date}`,
    noFileYet: "Pas encore de fichier · Ouvrir pour trouver une release",
    acquisitionNeedsAttention:
      "L’acquisition demande une action · Ouvrir pour réessayer",
    openToReplace: "Ouvrir pour remplacer ou gérer les fichiers",
    season: ({ n }: { n: number }) => `Saison ${n}`,
    thisSeason: "cette saison",
    entireSeasonPack: "Pack de saison complète",
    seasonField: "Saison",
    seasonHint: "Recherchez un pack de saison ou affinez vers un épisode.",
    releaseTarget: "Cible de la release",
    releaseTargetHint:
      "Les épisodes manquants, en échec, en file ou en téléchargement sont listés un par un.",
    loadingMonitoredSeasons: "Chargement des saisons suivies…",
    loadingSeasons: "Chargement des saisons…",
    loadingEpisodes: "Chargement des épisodes…",
    loadingSeasonDetails: "Chargement des détails de la saison…",
    noMonitoredSeasons: "Aucune saison suivie",
    noMonitoredSeasonsDescription:
      "Revenez à la gestion et sélectionnez au moins une saison avant de chercher des releases.",
    noEpisodeDetails: "Pas encore de détails d’épisode",
    noEpisodeDetailsDescription:
      "Bobarr n’a pas encore reçu de calendrier d’épisodes pour cette saison.",
    noSeasonDetails: "Pas encore de détails de saison",
    retrySeasonsDescription:
      "Réessayez le chargement des saisons ci-dessus, ou utilisez les options de gestion ici.",
    chooseMonitoringDescription:
      "Choisissez le suivi pour ajouter des saisons, ou retirez ce titre de Bobarr.",
    backToManagement: "Retour à la gestion",
    searchJackettHelp:
      "Recherchez dans Jackett et choisissez une release éligible. Les liens et identifiants des trackers restent sur le serveur ; le navigateur ne reçoit qu’un identifiant de candidat de courte durée.",
    noTmdbMatch:
      "Bobarr ne peut pas chercher cet élément, car il n’a pas de correspondance TMDB valable.",
    episodeStatus: "État des épisodes",
    libraryHealth: "Santé de la bibliothèque",
    libraryStatus: "État de la bibliothèque",
    showSummary: "Résumé de la série",
    movieSummary: "Résumé du film",
    seasonSummary: "Résumé de la saison",
    seasons: "Saisons",
    recommendedActions: "Actions recommandées",
    whatToDoNext: "Que faire ensuite",
    seasonPackDownloading: "Téléchargement du pack de saison",
    readyOfTotal: ({ ready, total }: { ready: number; total: number }) =>
      `${ready} sur ${total} prêts`,
    packDownloadProgress: ({ season }: { season: string }) =>
      `Progression du pack ${season}`,
    overallEpisodeAvailability: ({ title }: { title: string }) =>
      `Disponibilité globale des épisodes de ${title}`,
    findRelease: "Trouver une release",
    findReleaseFor: ({ code, title }: { code: string; title: string }) =>
      `Trouver une release pour ${code} ${title}`,
    downloadEpisode: ({ code, title }: { code: string; title: string }) =>
      `Télécharger ${code} ${title}`,
    downloadEpisodeFile: ({
      code,
      title,
      file,
    }: {
      code: string;
      title: string;
      file: string;
    }) => `Télécharger ${code} ${title} — ${file}`,
    chooseMonitoring: "Choisir le suivi",
    findFirstMissing: "Trouver le premier épisode manquant",
    retryAutomaticSearch: "Relancer la recherche automatique",
    searchAnyRelease: "Chercher une release manuellement…",
    monitoringSettings: "Réglages de suivi",
    automaticMonitoring: "Suivi automatique",
    automaticMonitoringHint:
      "Détermine ce que Bobarr peut rechercher automatiquement.",
    doNotMonitor: "Ne pas suivre",
    selectedSeasons: "Saisons sélectionnées",
    allCurrentSeasons: "Toutes les saisons actuelles",
    chooseMonitoredSeasons: "Choisir les saisons suivies",
    monitorFutureSeasons: "Suivre les saisons futures",
    monitorFutureSeasonsHint:
      "Ajouter les saisons nouvellement annoncées après une actualisation des métadonnées.",
    saveMonitoring: "Enregistrer le suivi",
    confirmTmdbMatchShow:
      "Confirmez la correspondance TMDB de cette série depuis la revue d’analyse avant de modifier le suivi des saisons.",
    removeFromLibrary: "Retirer de la bibliothèque…",
    removeShow: "Retirer la série…",
    selectedSeasonsSummary: ({
      count,
      future,
    }: {
      count: number;
      future: boolean;
    }) =>
      `${count} saison${count === 1 ? "" : "s"} sélectionnée${count === 1 ? "" : "s"}${future ? " · saisons futures activées" : ""}`,
    automaticSearchesOff: "Les recherches automatiques sont désactivées",
    futureSeasonsOnly: "Saisons futures uniquement",
    ready: "Prêt",
    readyMonitoringOff: "Prêt · suivi désactivé",
    notMonitored: "Non suivi",
    needsAttention: "À traiter",
    upcoming: "À venir",
    airDateTba: "Date de diffusion à confirmer",
    airedFileMissing: "Diffusé · fichier manquant",
    missingEpisodes: "Épisodes manquants",
    tracked: "Suivi",
    fileReady: "Le fichier est prêt dans votre bibliothèque",
    checkingIndexers: "Interrogation des indexeurs",
    releaseSelected: "Release sélectionnée · en attente de téléchargement",
    movingFile: "Déplacement du fichier dans votre bibliothèque",
    percentDownloaded: ({ percent }: { percent: number }) =>
      `${percent} % téléchargés`,
    downloadInProgress: "Téléchargement en cours",
    automaticFailed: "L’acquisition automatique a échoué",
    ignoredByMonitoring: "Ignoré par le suivi actuel",
    airDateNotAnnounced: "La date de diffusion n’a pas été annoncée",
    airsToday: "Diffusé aujourd’hui",
    airsOn: ({ date }: { date: string }) => `Diffusion le ${date}`,
    airedMissingOn: ({ date }: { date: string }) =>
      `Diffusé le ${date} · aucun fichier dans la bibliothèque`,
    seasonOnTrack: "Cette saison est à jour",
    nothingToDo: "Rien à faire pour le moment.",
    watchingFutureSeasons: "Surveillance des saisons futures",
    watchingFutureSeasonsCopy:
      "Les saisons actuelles restent non suivies. Bobarr ajoutera les saisons annoncées après la baseline de métadonnées actuelle.",
    monitoringOffShow: "Le suivi est désactivé pour cette série",
    seasonNotMonitored: ({ season }: { season: string }) =>
      `${season} n’est pas suivie`,
    existingFilesStay:
      "Vos fichiers existants restent dans la bibliothèque. Choisissez des saisons pour que Bobarr comble les trous et suive les épisodes à venir.",
    confirmTmdbBeforeMonitoring:
      "Vos fichiers existants restent dans la bibliothèque. Confirmez la correspondance TMDB de cette série avant d’activer le suivi.",
    seasonPackDownloadingTitle:
      "Le pack de saison est en cours de téléchargement",
    seasonPackDownloadingCopy:
      "Les fichiers d’épisode passeront à Prêt une fois que Bobarr aura classé le pack.",
    airedMissingTitle: ({ count }: { count: number }) =>
      count === 1
        ? "1 épisode diffusé est manquant"
        : `${count} épisodes diffusés sont manquants`,
    airedMissingCopy:
      "Bobarr n’a pas de fichier pour ces épisodes. Relancez la recherche automatique ou inspectez les releases actuelles vous-même.",
    inProgressTitle: ({ count }: { count: number }) =>
      count === 1
        ? "1 épisode est en cours"
        : `${count} épisodes sont en cours`,
    inProgressCopy:
      "Bobarr les recherche, les télécharge ou les classe. Aucune action n’est nécessaire.",
    caughtUp: "Vous êtes à jour",
    willSearchAutomatically: ({ copy }: { copy: string }) =>
      `${copy}. Bobarr lancera la recherche automatiquement.`,
    futureEpisodesAuto:
      "Les épisodes à venir seront recherchés automatiquement à leur diffusion.",
    seasonComplete: "Saison complète",
    seasonCompleteCopy:
      "Chaque épisode suivi est prêt dans votre bibliothèque.",
    overviewReadyToConfigure: "Le suivi des épisodes est prêt à être configuré",
    overviewOpenSeason:
      "Ouvrez une saison pour voir chaque épisode, sa date de diffusion et ce que Bobarr fera ensuite.",
    monitoringIsOff: "Le suivi est désactivé",
    existingFilesRemain: ({ count }: { count: number }) =>
      `${count} fichier${count === 1 ? " existant reste" : "s existants restent"} dans votre bibliothèque. Parcourez les saisons téléchargées ci-dessous ou choisissez ce que Bobarr doit suivre.`,
    noAutomaticSearches:
      "Aucune recherche automatique ne sera lancée. Choisissez ce que Bobarr doit suivre, ou retirez ce titre de la bibliothèque.",
    futureSeasonMonitoringOn: "Le suivi des saisons futures est activé",
    futureSeasonMonitoringCopy:
      "Les saisons déjà téléchargées restent dans votre bibliothèque sans nouvelle recherche. Les saisons nouvellement annoncées seront ajoutées automatiquement.",
    monitoredEpisodesReady: ({
      ready,
      total,
    }: {
      ready: number;
      total: number;
    }) =>
      `${ready} sur ${total} épisode${total === 1 ? "" : "s"} suivi${total === 1 ? "" : "s"} ${ready === 1 ? "est prêt" : "sont prêts"}`,
    noFileInLibrary: "Aucun fichier dans votre bibliothèque",
    monitoringCanSearch: "Bobarr suit ce film et peut rechercher une release.",
    monitoringOffTurnOn:
      "Le suivi automatique est désactivé. Activez-le ci-dessous si vous voulez que Bobarr trouve ce film.",
    readyInLibrary: "Prêt dans votre bibliothèque",
    readyMonitoringOn:
      "Votre copie classée est prête. Le suivi reste actif au cas où Bobarr devrait l’acquérir à nouveau.",
    readyMonitoringOffMovie:
      "Votre copie classée est prête. Bobarr la laissera telle quelle, sauf si vous choisissez un remplacement ponctuel.",
    workingOnRelease: ({ state }: { state: string }) =>
      `${state} de votre film`,
    workingOnReleaseCopy:
      "Bobarr traite la release sélectionnée. La progression et la destination sont affichées ci-dessous.",
    acquisitionNeedsAttentionTitle:
      "L’acquisition automatique demande une action",
    acquisitionNeedsAttentionCopy:
      "Aucun fichier prêt n’a été créé. Relancez la recherche ou choisissez une release vous-même.",
    notMonitoredNoFile: "Non suivi et aucun fichier trouvé",
    monitoringOnSummary: "Activé · Bobarr peut réacquérir ce film si besoin",
    monitoringOffReplacement:
      "Désactivé · un remplacement ponctuel reste possible",
    monitoringOffNoSearch: "Désactivé · Bobarr ne cherchera pas",
    moreLikeThis: "Plus comme ceci",
    currentCopy: "Copie actuelle",
    acquisition: "Acquisition",
    movieFile: "Fichier du film",
    findThisMovie: "Trouver ce film",
    noOrganizedFile: "Aucun fichier classé",
    searchOrRetry:
      "Cherchez une release ou relancez l’acquisition automatique.",
    turnOnMonitoring: "Activez le suivi pour que Bobarr en acquière un.",
    movieDownloads: "Téléchargements du film",
    movieManagement: "Gestion du film",
    downloadStatus: "État du téléchargement",
    wantDifferentCopy: "Vous voulez une autre copie ?",
    chooseAnotherRelease: "Choisir une autre release",
    replacementCopy:
      "Choisissez un remplacement ponctuel sans activer le suivi. Votre fichier actuel reste en place jusqu’à ce que le nouveau téléchargement soit prêt.",
    replaceActive:
      "Remplacez l’acquisition en cours par une release de votre choix.",
    chooseReplacement: "Choisir un remplacement…",
    chooseReleaseYourself: "Choisissez une release vous-même",
    reviewJackett:
      "Consultez les résultats Jackett actuels au lieu d’attendre la prochaine recherche automatique.",
    searchReleasesManually: "Chercher des releases manuellement…",
    confirmMovieTmdb:
      "Confirmez la correspondance TMDB de ce film avant de chercher une release. Le retrait reste possible.",
    libraryCleanup: "Nettoyage de la bibliothèque",
    removeThisMovie: "Retirer ce film",
    removeRecordOrFile:
      "Retirez seulement l’enregistrement Bobarr, ou supprimez aussi le fichier classé. Vous choisirez à l’écran suivant.",
    removeMovieStopSearches:
      "Retirez ce film de Bobarr et arrêtez les recherches automatiques futures.",
    offKeepCurrent: "Désactivé — conserver uniquement le fichier actuel",
    offDoNotAcquire: "Désactivé — ne pas acquérir ce film",
    onSearchIfMissing: "Activé — rechercher à nouveau s’il manque",
    replacementNoMonitoring: "Un remplacement ponctuel n’exige pas le suivi.",
    confirmMovieTmdbMonitoring:
      "Confirmez la correspondance TMDB de ce film avant de modifier le suivi.",
    tvShowDetails: "Détails de la série",
    movieDetails: "Détails du film",
    chooseReplacementFor: ({ title }: { title: string }) =>
      `Choisir un remplacement pour ${title}`,
    findReleaseForTitle: ({ title }: { title: string }) =>
      `Trouver une release pour ${title}`,
    titleFallback: "titre",
    yearTvDescription: ({ year }: { year: string }) =>
      `${year} · Série TV · État des épisodes et suivi`,
    yearMovieDescription: ({ year }: { year: string }) =>
      `${year} · Film · Fichier, remplacement et suivi`,
    removeFromLibraryQuestion: "Retirer de la bibliothèque ?",
    chooseWhatToRemove:
      "Choisissez si l’enregistrement Bobarr doit être retiré et quelles données stockées doivent aussi être supprimées.",
    removeTitleFromBobarr: "Retirer ce titre de Bobarr",
    filesStayUnlessDeleted:
      "Les fichiers restent sur le disque sauf si vous sélectionnez la suppression ci-dessous. Une analyse future de la bibliothèque pourra retrouver le titre.",
    deleteOrganizedFiles: "Supprimer les fichiers classés",
    deletesFilesFrom: ({
      files,
      size,
      folder,
    }: {
      files: string;
      size: string;
      folder: string;
    }) => `Supprime ${files}${size} de votre dossier ${folder}.`,
    sizeInParens: ({ size }: { size: string }) => ` (${size})`,
    removesFilesFromFolder:
      "Retire les fichiers de votre dossier films ou séries.",
    moviesFolder: "films",
    televisionFolder: "séries",
    removeTorrent: "Retirer le torrent de Transmission",
    removeTorrentHint:
      "Arrête le partage et supprime l’enregistrement du torrent.",
    deleteOriginalData: "Supprimer les données de téléchargement d’origine",
    cannotBeUndone: "Cette action est irréversible.",
    willRemoveTitleAndFiles:
      "Bobarr retirera ce titre et ses fichiers classés. Cette action est irréversible.",
    remainsUnmonitored:
      "Le titre reste visible comme non suivi tant que son enregistrement n’est pas retiré.",
    confirmRemoval: "Confirmer le retrait",
    selectItemFirst: "Sélectionnez d’abord un élément de la bibliothèque.",
    noMatchingTitles: "Aucun titre correspondant",
    changeFilters:
      "Modifiez vos filtres pour voir davantage de votre bibliothèque.",
    downloadMovie: "Télécharger le film",
    downloadNamed: ({ name }: { name: string }) => `Télécharger ${name}`,
    episode: "Épisode",
    recentlyAddedDescription: ({ label }: { label: string }) =>
      `Les derniers ${label} arrivés dans votre bibliothèque.`,
    recentlyDownloadedEpisodes: "Épisodes téléchargés récemment",
    recentlyDownloadedEpisodesCopy:
      "Les fichiers d’épisode qui viennent d’arriver dans votre bibliothèque.",
    loadingRecentlyDownloaded: "Chargement des épisodes téléchargés récemment…",
    needsAttentionShelf: "À traiter",
    needsAttentionShelfCopy:
      "Acquisitions manquantes ou en échec qui attendent encore une release.",
    highlyRated: "Les mieux notés",
    highlyRatedCopy: ({ label }: { label: string }) =>
      `Vos ${label} notés 7,0 et plus.`,
    genreShelfCopy: ({ genre, label }: { genre: string; label: string }) =>
      `Une étagère tirée des ${label} ${genre} que vous conservez déjà.`,
    loadingNamed: ({ name }: { name: string }) => `Chargement de ${name}…`,
    openSeriesEpisode: ({
      series,
      code,
      episode,
    }: {
      series: string;
      code: string;
      episode: string;
    }) => `Ouvrir ${series}, ${code} ${episode}`,
    moviesReadyToGrow: "Votre bibliothèque de films est prête à grandir",
    showsReadyToGrow: "Votre bibliothèque de séries est prête à grandir",
    emptyGuidance:
      "Commencez par les fichiers que vous avez déjà, ou laissez Bobarr en trouver de nouveaux.",
    scanExistingMovies: "Analyser les films existants",
    scanExistingShows: "Analyser les séries existantes",
    getSuggestions: "Obtenir des suggestions",
    browseDiscover: "Parcourir Découvrir",
    needsAttentionStrip: "La bibliothèque demande une action",
    failedCount: ({ count }: { count: number }) => `${count} en échec`,
    missingCount: ({ count }: { count: number }) => `${count} manquants`,
    showFailed: "Afficher les échecs",
    showMissing: "Afficher les manquants",
    moviesLabel: "films",
    showsLabel: "séries",
  },
  activity: {
    eyebrow: "Opérations",
    title: "Activité",
    description:
      "Téléchargements, acquisitions et événements système, sans quitter Bobarr.",
    view: "Vue d’activité",
    downloads: "Téléchargements",
    jobs: "Tâches",
    history: "Historique",
    downloadStatus: "État du téléchargement",
    active: "Actifs",
    completed: "Terminés",
    all: "Tous",
    jobType: "Type de tâche",
    allJobTypes: "Tous les types de tâches",
    updatingJobs: "Mise à jour des tâches…",
    runMaintenance: "Lancer une maintenance",
    runMaintenanceHint:
      "Mettez une analyse ou une tâche de maintenance en file et suivez sa progression ci-dessous.",
    task: "Tâche",
    runJob: "Lancer la tâche",
    jobsPagination: "Pagination des tâches",
    previous: "Précédent",
    next: "Suivant",
    pageRange: ({
      from,
      to,
      total,
    }: {
      from: number;
      to: number;
      total: number;
    }) => `${from}–${to} sur ${total}`,
    contactingTransmission: "Contact de Transmission…",
    addDownload: "Ajouter un téléchargement",
    addDownloadDescription:
      "Seuls les magnets et les fichiers torrent de taille limitée sont acceptés.",
    downloadSource: "Source du téléchargement",
    magnetUri: "URI magnet",
    noJobsTitle: "Aucune tâche en arrière-plan",
    noJobsDescription:
      "Les recherches planifiées, analyses et classements apparaîtront ici.",
    noHistoryTitle: "Rien à signaler pour le moment",
    noHistoryDescription:
      "Les événements d’acquisition, de bibliothèque et de service constitueront un historique lisible ici.",
    removeDownload: "Retirer le téléchargement ?",
    addDownloadAction: "Ajouter le téléchargement",
    magnetLink: "Lien magnet",
    torrentFile: "Fichier .torrent",
    magnetPlaceholder: "magnet:?xt=urn:btih:…",
    chooseTorrent: "Choisir un fichier .torrent",
    torrentHint:
      "Métainfo uniquement · la limite de taille est appliquée par Bobarr",
    invalidMagnet: "Saisissez une URI magnet valable.",
    chooseTorrentFirst: "Choisissez d’abord un fichier .torrent.",
    selectDownloadFirst: "Sélectionnez d’abord un téléchargement.",
    pause: "Pause",
    resume: "Reprendre",
    retry: "Réessayer",
    remove: "Retirer",
    chooseFiles: "Choisir les fichiers",
    priority: ({ value }: { value: string }) => `priorité ${value}`,
    nothingDownloading: "Rien n’est en cours de téléchargement",
    noCompletedDownloads: "Aucun téléchargement terminé",
    noDownloadsYet: "Pas encore de téléchargements",
    finishedDownloads:
      "Les téléchargements terminés apparaîtront ici une fois achevés.",
    automaticDownloads:
      "Les acquisitions automatiques et les torrents ajoutés manuellement apparaîtront ici.",
    loadOlderDownloads: "Charger les téléchargements plus anciens",
    downloadsWithCount: ({ count }: { count: number }) =>
      count ? `Téléchargements · ${count}` : "Téléchargements",
    scheduled: ({ when }: { when: string }) => `Planifié ${when}`,
    attemptOf: ({ attempts, max }: { attempts: number; max: number }) =>
      `Tentative ${attempts} sur ${max}`,
    of: ({ from, to }: { from: number | string; to: number | string }) =>
      `${from} sur ${to}`,
    jobDetails: "Détails de la tâche",
    jobDetailsDescription:
      "État d’exécution persisté et journal de cycle de vie de cette tâche en arrière-plan.",
    loadingJobLog: "Chargement du journal de la tâche…",
    jobStatus: "État",
    attempts: "Tentatives",
    scheduledAt: "Planifiée",
    jobId: "ID de tâche",
    executionLog: "Journal d’exécution",
    emptyJobLog:
      "Aucune entrée de cycle de vie n’a été enregistrée pour cette ancienne tâche.",
    jobPayload: "Charge utile de la tâche",
    jobQueued: ({ kind }: { kind: string }) => `${kind} mise en file.`,
    removeDownloadDescription:
      "Le torrent peut être retiré tout en conservant les données téléchargées. S’il est lié à un média de la bibliothèque, le suivi automatique s’arrête pour ce film, cette saison ou cet épisode, afin que Bobarr ne le rajoute pas tout de suite.",
    alsoDeleteData: "Supprimer aussi les données téléchargées",
    alsoDeleteDataHint:
      "C’est définitif et cela peut affecter les fichiers classés en cas de déplacement ou de lien symbolique.",
    keepDownload: "Conserver le téléchargement",
    jobKinds: {
      "media.acquire.v1": "Acquisition de média",
      "acquisition.add-torrent": "Ajouter un torrent",
      "acquisition.organize-download": "Classer le téléchargement",
      "library.scan.v1": "Analyse de la bibliothèque",
      "maintenance.reconcile.v1": "Réconcilier les services",
      "maintenance.search-missing.v1": "Rechercher les médias manquants",
      "maintenance.refresh-metadata.v1": "Actualiser les métadonnées",
      "maintenance.backup.v1": "Sauvegarde",
      "maintenance.cleanup.v1": "Nettoyage",
    },
  },
  settings: {
    eyebrow: "Configuration",
    title: "Réglages",
    description:
      "Connexions, préférences d’acquisition, stockage et maintenance.",
    sections: "Sections des réglages",
    connections: "Connexions",
    preferences: "Préférences",
    storage: "Stockage",
    schedules: "Planifications",
    maintenance: "Maintenance",
    security: "Sécurité",
    people: "Personnes",
    metadataLanguage: "Langue des métadonnées",
    metadataLanguageHint:
      "Langue ISO 639-1 du catalogue pour les titres. Ce n’est pas la langue de l’interface.",
    region: "Région",
    regionHint: "Code pays à deux lettres",
    isoLanguage: "Saisissez un code langue ISO.",
    twoLetterRegion: "Utilisez un code région à deux lettres.",
    validJackettUrl: "Saisissez une URL Jackett valide.",
    validTransmissionUrl: "Saisissez une URL Transmission valide.",
    addQuality: "Ajoutez au moins une qualité.",
    absolutePath: "Utilisez un chemin absolu.",
    loading: "Chargement des réglages…",
    connectionsBody:
      "Les identifiants sont chiffrés au repos et ne sont jamais renvoyés en entier.",
    preferencesTitle: "Préférences d’acquisition",
    preferencesBody:
      "Les limites strictes excluent les releases ; les termes et la qualité déterminent le classement.",
    storageTitle: "Stockage et organisation",
    storageBody:
      "Tous les chemins doivent se trouver sous la racine média montée.",
    schedulesBody: "Expressions cron à cinq champs évaluées en UTC.",
    maintenanceBody:
      "Sauvegardez l’état de l’application avant une mise à niveau ou un changement de stockage.",
    securityTitle: "Sécurité de connexion",
    securityBody:
      "Contrôlez la protection temporaire après des échecs de mot de passe.",
    tmdbApiKey: "Clé API TMDB",
    omdbApiKey: "Clé API OMDb",
    jackettUrl: "URL Jackett",
    jackettUrlHint:
      "Utilisez l’URL de l’instance Jackett ; les URL de reverse-proxy, de tableau de bord et Torznab copiées sont normalisées en toute sécurité.",
    jackettApiKey: "Clé API Jackett",
    transmissionRpcUrl: "URL RPC Transmission",
    transmissionUsername: "Nom d’utilisateur Transmission",
    transmissionPassword: "Mot de passe Transmission",
    keepSecret: "Laissez vide pour conserver le secret actuel",
    minimumSeeders: "Seeders minimum",
    minimumSizeMb: "Taille minimale (Mo)",
    maximumSizeMb: "Taille maximale (Mo)",
    noMinimum: "Pas de minimum",
    noMaximum: "Pas de maximum",
    qualityOrder: "Ordre des qualités",
    qualityOrderHint:
      "Priorité la plus haute en premier, séparée par des virgules.",
    downloadsPath: "Chemin des téléchargements",
    moviesPath: "Chemin des films",
    televisionPath: "Chemin des séries",
    organizationStrategy: "Stratégie d’organisation",
    organizationHint:
      "Les liens physiques conservent le seeding sans dupliquer les données.",
    hardlink: "Lien physique (recommandé)",
    symlink: "Lien symbolique",
    copy: "Copie",
    move: "Déplacement",
    validatePaths: "Valider les chemins",
    searchMissing: "Rechercher les médias manquants",
    refreshMetadata: "Actualiser les métadonnées",
    scanLibrary: "Analyser la bibliothèque",
    createBackup: "Créer une sauvegarde",
    backupsToRetain: "Sauvegardes à conserver",
    createBackupNow: "Créer une sauvegarde maintenant",
    createBackupHint:
      "Un instantané SQLite cohérent est conservé dans votre volume de configuration.",
    backUp: "Sauvegarder",
    stageRestore: "Préparer une restauration de base",
    stageRestoreHint:
      "Le fichier est vérifié maintenant et appliqué seulement après un redémarrage de Bobarr.",
    offlinePasswordReset: "Réinitialisation hors ligne du mot de passe",
    offlinePasswordResetHint:
      "Utilisez la commande CLI documentée sur l’hôte Bobarr.",
    hostOnly: "Hôte uniquement",
    stagedRestore: ({ size }: { size: string }) =>
      `Une restauration est préparée pour le prochain redémarrage. Son image vérifiée fait ${size}.`,
    verifiedBackups: "Sauvegardes d’application vérifiées",
    noVerifiedBackups: "Aucune sauvegarde vérifiée pour le moment.",
    checkingBackups: "Vérification des sauvegardes…",
    schemaVersion: ({ version, name }: { version: number; name: string }) =>
      `Schéma ${version} · ${name}`,
    temporarilyLock: "Verrouiller temporairement la connexion",
    temporarilyLockHint:
      "Bloquez les nouvelles connexions pendant un court moment après des échecs répétés de mot de passe.",
    resetSignInLock: "Réinitialiser le verrouillage",
    resetSignInLockHint:
      "Effacez le verrouillage actuel et toutes les tentatives échouées enregistrées.",
    thisSession: "Cette session",
    thisSessionHint:
      "Déconnectez ce navigateur sans interrompre le travail en arrière-plan.",
    unsavedChanges: "Vous avez des modifications non enregistrées.",
    settingsUpToDate: "Les réglages sont à jour.",
    saveSettings: "Enregistrer les réglages",
    stageRestoreTitle: "Préparer la restauration de la base",
    stageRestoreDescription:
      "Cela modifiera l’état de l’application au prochain redémarrage.",
    restoreWarning:
      "Les téléchargements, enregistrements de bibliothèque, réglages, sessions administrateur et secrets chiffrés reviendront à l’état de la sauvegarde. Conservez la même clé maître, sinon les secrets des connecteurs ne pourront pas être déchiffrés.",
    selectedFile: ({ name, size }: { name: string; size: string }) =>
      `Sélectionné : ${name} (${size})`,
    typeRestoreToConfirm: "Saisissez « RESTORE » pour confirmer",
    verifyAndStage: "Vérifier et préparer la restauration",
    savedSecurely: "Réglages enregistrés de façon sécurisée.",
    connectionResult: ({
      label,
      healthy,
    }: {
      label: string;
      healthy: boolean;
    }) =>
      `La connexion ${label} ${healthy ? "est prête" : "demande une action"}.`,
    storageAccessible: "Les chemins de stockage sont accessibles.",
    storageValidationFailed: "La validation du stockage a échoué.",
    backupCreated: "Sauvegarde créée et vérifiée.",
    restoreStaged:
      "Restauration préparée. Redémarrez Bobarr pour l’appliquer ; une sauvegarde de rollback sera créée d’abord.",
    loginLockReset:
      "Verrouillage temporaire de connexion et échecs réinitialisés.",
  },
  people: {
    title: "Personnes",
    description:
      "Invitez des amis en tant qu’utilisateurs. Promouvez quelqu’un s’il doit aussi modifier les réglages.",
    inviteSomeone: "Inviter quelqu’un",
    copyInvite: "Copier le lien d’invitation",
    openInvite: "Invitation ouverte",
    makeAdmin: "Rendre admin",
    makeUser: "Rendre utilisateur",
    expires: ({ date }: { date: string }) => `Expire le ${date}`,
    inviteCreated:
      "Lien d’invitation créé. Copiez-le maintenant ; il n’est affiché qu’une fois.",
    inviteRevoked: "Invitation révoquée.",
    accountDeleted: "Compte supprimé.",
    nowAdmin: ({ username }: { username: string }) =>
      `${username} est maintenant administrateur.`,
    nowUser: ({ username }: { username: string }) =>
      `${username} est maintenant un utilisateur.`,
    rankAdmin: "admin",
    rankUser: "utilisateur",
  },
  catalog: {
    viewTitle: ({ title }: { title: string }) => `Voir ${title}`,
    tracked: "Suivi",
    yearUnavailable: "Année indisponible",
    yearTba: "Année à venir",
    externalRatings: "Notes externes",
    imdbRating: ({ value, scale }: { value: string; scale: number }) =>
      `Note IMDb ${value} sur ${scale}`,
    tomatoesRating: ({ value }: { value: number }) =>
      `Note Rotten Tomatoes ${value} pour cent`,
    topCast: "Distribution principale",
    actors: "Acteurs",
    discoverWith: ({ name }: { name: string }) =>
      `Découvrir des films avec ${name}`,
    noSynopsis: "Aucun synopsis n’est encore disponible.",
    watchTrailer: "Voir la bande-annonce",
    trailerFor: ({ title }: { title: string }) => `Bande-annonce de ${title}`,
    addToLibrary: "Ajouter à la bibliothèque",
    openInLibrary: "Ouvrir dans la bibliothèque",
    keepBrowsing: "Continuer à parcourir",
    chooseSeasons: "Choisir les saisons",
    chooseSeasonsHint:
      "Seules les saisons sélectionnées sont recherchées automatiquement.",
    selectAll: "Tout sélectionner",
    latest: "La plus récente",
    loadingYear: "Chargement de l’année…",
    monitorFutureSeasons: "Suivre les saisons futures",
    monitorFutureSeasonsHint:
      "Inclure les saisons nouvellement annoncées lors de l’actualisation des métadonnées.",
    manualSearch: "Recherche manuelle",
    hideReleases: "Masquer les releases",
    addAndSearchManually: "Ajouter et chercher manuellement",
    addBeforeSearch:
      "Ajoutez ce titre à votre bibliothèque avant de chercher des releases",
    titleDetails: "Détails du titre",
    addedManual:
      "Ajouté à votre bibliothèque sans lancer de téléchargement. Choisissez une release ci-dessous quand vous serez prêt.",
    addedAutomatic:
      "Ajouté à votre bibliothèque. Bobarr cherchera une release éligible.",
    chooseManualFirst:
      "Choisissez Ajouter et chercher manuellement pour sélectionner une release avant tout téléchargement.",
    addBeforeGrab:
      "Ajoutez ce titre à votre bibliothèque avant de chercher ou de récupérer une release.",
    seasonForManualSearch: "Saison pour la recherche manuelle",
    attachesToSeason:
      "Bobarr associe la release sélectionnée à cette saison suivie.",
    selectTitleFirst: "Sélectionnez d’abord un titre du catalogue.",
    rottenTomatoes: "Rotten Tomatoes",
    imdb: "IMDb",
  },
  releases: {
    noReleasesTitle: "Aucune release trouvée",
    noReleasesDescription:
      "Réessayez plus tard ou ajustez votre profil de release dans Réglages.",
    searching: "Recherche dans les indexeurs…",
    exclusionReasons: "Motifs d’exclusion",
    jackettQuery: "Requête Jackett",
    searchJackett: "Rechercher dans Jackett",
    grab: "Récupérer",
    replace: "Remplacer",
    excluded: "Exclue",
    releaseCandidates: "Candidats de release",
    generatingQuery: "Génération d’une requête…",
    queryHint:
      "Modifiez la requête générée et relancez la recherche. L’association au média et le lien du candidat utilisent toujours le titre et l’épisode sélectionnés.",
    score: ({ value }: { value: number }) => `Score ${value}`,
    seeders: ({ count }: { count: number }) => `${count} seeders`,
    replacementUnbound:
      "Ce remplacement n’est plus lié à un média de la bibliothèque.",
    replacementWarning:
      "Choisir un candidat lance un remplacement explicite. Tout téléchargement Bobarr actif pour cet élément est arrêté et ses données incomplètes sont supprimées ; un fichier classé reste jusqu’à ce que son remplacement soit prêt.",
    queuedNotice: ({
      kind,
      title,
    }: {
      kind: "replacement" | "release";
      title: string;
    }) =>
      `${kind === "replacement" ? "Remplacement" : "Release"} mis en file : ${title}. Suivez-le dans Activité.`,
    replacementKind: "Remplacement",
    releaseKind: "Release",
  },
  scanReview: {
    needsMatch: "Correspondance requise",
    importTitle: "Importer ce titre",
    searchTmdb: "Rechercher dans TMDB manuellement",
    noDescription: "Aucune description disponible.",
    invalidTmdbUrl: "URL TMDB non valable.",
    minSearch: "Saisissez au moins 2 caractères pour chercher dans TMDB.",
    searchFailed: "La recherche TMDB a échoué.",
    manualSearch: "Recherche TMDB manuelle",
    searchHint:
      "Essayez un autre titre, ou collez une URL TMDB ou un identifiant numérique pour une correspondance exacte.",
    tmdbTitle: "Titre TMDB",
    placeholder: "Titre, URL TMDB ou identifiant…",
    noTitlesFound: "Aucun titre TMDB trouvé. Essayez une autre recherche.",
    searchResults: "Résultats de recherche TMDB",
    candidates: "Candidats TMDB",
    kindMismatch: ({ expected, found }: { expected: string; found: string }) =>
      `Cette revue ${expected} ne peut pas être associée à une URL ${found}.`,
    filesLine: ({ year, files }: { year: string; files: string }) =>
      `${year} · ${files}`,
    foundUnder: ({ path }: { path: string }) => `Trouvé sous ${path}`,
    loadFailed: ({ message }: { message: string }) =>
      `Impossible de charger les revues d’analyse. ${message}`,
    matchReview: "Revue de correspondance",
    chooseTitle: "Choisissez le bon titre TMDB",
    chooseTitleBody:
      "Bobarr a trouvé des dossiers ambigus et ne fera pas de supposition. Confirmez une correspondance pour importer les fichiers enregistrés.",
    pending: ({ count }: { count: number }) => `${count} en attente`,
  },
  terms: {
    required: "Termes requis",
    requiredHint:
      "Chaque terme séparé par une virgule doit être présent, sinon la release est exclue.",
    preferred: "Termes préférés",
    preferredHint:
      "Termes séparés par des virgules qui augmentent le score d’une release.",
    rejected: "Termes rejetés",
    rejectedHint:
      "Termes séparés par des virgules qui rendent une release inéligible.",
  },
} satisfies Messages;
