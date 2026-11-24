// Google rich-result requirements as data. Upkeep means editing one entry: each one names the
// Google Search Central page it was taken from and the date it was last compared with it.
//
// Requirement syntax, relative to the node being checked:
//   "name"            the property must be present (an empty string or array counts as absent)
//   "author.name"     a nested property. It is only reported when "author" exists, or when
//                     "author" isn't listed on its own (so a missing parent is reported once)
//   "review|offers"   at least one of the alternatives
//
// Recommended lists keep the properties that apply to most pages. Situational ones (expires,
// regionsAllowed, variant attributes like color and size, identifiers like duns or naics) are
// left out so a typical page isn't buried in warnings.

export interface Shape {
  /** Selects this shape for values of these @types, when a property lists several shapes. */
  types?: readonly string[];
  required?: readonly string[];
  recommended?: readonly string[];
  /** Required on every value of a list except the last (breadcrumb `item`). */
  requiredExceptLast?: readonly string[];
  /** The property holding these values needs at least this many of them. */
  minItems?: number;
  /** Shapes for the values of nested properties. */
  properties?: Readonly<Record<string, Shape | readonly Shape[]>>;
  /** Values of `types` don't qualify for the feature. Reported as a warning with this reason, not checked further. */
  ineligible?: string;
}

export interface RichResultType extends Shape {
  feature: string;
  types: readonly string[];
  source: string;
  /** Date the entry was last compared with `source`. */
  checked: string;
  /** Why Google no longer shows the rich result. Deprecated entries are not checked further. */
  deprecated?: string;
  /** Only check the entry when this property is present. */
  appliesWhen?: string;
  /** Match nodes at any depth, not only top-level, @graph, mainEntity and list items. */
  matchNested?: boolean;
}

const DOCS = "https://developers.google.com/search/docs/appearance/structured-data/";

const ARTICLE_TYPES = [
  "Article", "AdvertiserContentArticle", "NewsArticle", "AnalysisNewsArticle", "AskPublicNewsArticle",
  "BackgroundNewsArticle", "OpinionNewsArticle", "ReportageNewsArticle", "ReviewNewsArticle",
  "BlogPosting", "LiveBlogPosting", "Report", "SatiricalArticle", "ScholarlyArticle", "TechArticle",
];

const LOCAL_BUSINESS_TYPES = [
  "LocalBusiness", "AnimalShelter", "ArchiveOrganization", "AutomotiveBusiness", "AutoBodyShop", "AutoDealer",
  "AutoPartsStore", "AutoRental", "AutoRepair", "AutoWash", "GasStation", "MotorcycleDealer", "MotorcycleRepair",
  "ChildCare", "Dentist", "DryCleaningOrLaundry", "EmergencyService", "FireStation", "Hospital", "PoliceStation",
  "EmploymentAgency", "EntertainmentBusiness", "AdultEntertainment", "AmusementPark", "ArtGallery", "Casino",
  "ComedyClub", "MovieTheater", "NightClub", "FinancialService", "AccountingService", "AutomatedTeller",
  "BankOrCreditUnion", "InsuranceAgency", "FoodEstablishment", "Bakery", "BarOrPub", "Brewery", "CafeOrCoffeeShop",
  "Distillery", "FastFoodRestaurant", "IceCreamShop", "Restaurant", "Winery", "GovernmentOffice", "PostOffice",
  "HealthAndBeautyBusiness", "BeautySalon", "DaySpa", "HairSalon", "HealthClub", "NailSalon", "TattooParlor",
  "HomeAndConstructionBusiness", "Electrician", "GeneralContractor", "HVACBusiness", "HousePainter", "Locksmith",
  "MovingCompany", "Plumber", "RoofingContractor", "InternetCafe", "LegalService", "Attorney", "Notary", "Library",
  "LodgingBusiness", "BedAndBreakfast", "Campground", "Hostel", "Hotel", "Motel", "Resort", "MedicalBusiness",
  "MedicalClinic", "Optician", "Pharmacy", "Physician", "ProfessionalService", "RadioStation", "RealEstateAgent",
  "RecyclingCenter", "SelfStorage", "ShoppingCenter", "SportsActivityLocation", "BowlingAlley", "ExerciseGym",
  "GolfCourse", "PublicSwimmingPool", "SkiResort", "SportsClub", "StadiumOrArena", "TennisComplex", "Store",
  "BikeStore", "BookStore", "ClothingStore", "ComputerStore", "ConvenienceStore", "DepartmentStore",
  "ElectronicsStore", "Florist", "FurnitureStore", "GardenStore", "GroceryStore", "HardwareStore", "HobbyShop",
  "HomeGoodsStore", "JewelryStore", "LiquorStore", "MensClothingStore", "MobilePhoneStore", "MovieRentalStore",
  "MusicStore", "OfficeEquipmentStore", "OutletStore", "PawnShop", "PetStore", "ShoeStore", "SportingGoodsStore",
  "TireShop", "ToyStore", "WholesaleStore", "TelevisionStation", "TouristInformationCenter", "TravelAgency",
];

const ORGANIZATION_TYPES = [
  "Organization", "Airline", "Consortium", "Corporation", "EducationalOrganization", "CollegeOrUniversity", "School",
  "GovernmentOrganization", "LibrarySystem", "MedicalOrganization", "NGO", "NewsMediaOrganization", "OnlineBusiness",
  "OnlineStore", "PerformingGroup", "PoliticalParty", "Project", "ResearchOrganization", "SportsOrganization",
  "SportsTeam", "WorkersUnion", ...LOCAL_BUSINESS_TYPES,
];

const EVENT_TYPES = [
  "Event", "BusinessEvent", "ChildrensEvent", "ComedyEvent", "DanceEvent", "DeliveryEvent", "EducationEvent",
  "ExhibitionEvent", "Festival", "FoodEvent", "Hackathon", "LiteraryEvent", "MusicEvent", "SaleEvent",
  "ScreeningEvent", "SocialEvent", "SportsEvent", "TheaterEvent", "VisualArtsEvent",
];

// Nested shapes shared by several entries. Identical requirement strings across entries let
// a property missing for two features be reported once, naming both.
const PRICE = "price|priceSpecification.price";
const PRICE_CURRENCY = "priceCurrency|priceSpecification.priceCurrency";

const AGGREGATE_RATING: Shape = { required: ["ratingValue", "ratingCount|reviewCount"] };
const REVIEW: Shape = { required: ["author", "author.name", "reviewRating", "reviewRating.ratingValue"], recommended: ["datePublished"] };
const AGGREGATE_OFFER: Shape = { types: ["AggregateOffer"], required: ["lowPrice", "priceCurrency"], recommended: ["highPrice", "offerCount"] };
const RATINGS = { aggregateRating: AGGREGATE_RATING, review: REVIEW };

const ANSWER: Shape = { required: ["text"], recommended: ["author", "url", "datePublished"] };

export const RICH_RESULT_TYPES: readonly RichResultType[] = [
  {
    feature: "Article",
    types: ARTICLE_TYPES,
    source: `${DOCS}article`,
    checked: "2026-11-24",
    recommended: ["author", "author.name", "author.url|author.sameAs", "datePublished", "dateModified", "headline", "image"],
  },
  {
    feature: "Product snippet",
    types: ["Product"],
    source: `${DOCS}product-snippet`,
    checked: "2026-11-24",
    required: ["name", "review|aggregateRating|offers"],
    recommended: ["aggregateRating", "offers", "review"],
    properties: {
      ...RATINGS,
      offers: [AGGREGATE_OFFER, { required: [PRICE], recommended: ["availability", PRICE_CURRENCY, "priceValidUntil"] }],
    },
  },
  {
    feature: "Merchant listing",
    types: ["Product"],
    source: `${DOCS}merchant-listing`,
    checked: "2026-11-24",
    appliesWhen: "offers",
    required: ["name", "image", "offers"],
    recommended: ["description", "brand.name", "gtin|gtin8|gtin12|gtin13|gtin14|isbn", "mpn", "sku"],
    properties: {
      offers: [
        {
          types: ["AggregateOffer"],
          ineligible: "Merchant listings need an Offer, because the merchant must be the seller. AggregateOffer still works for product snippets.",
        },
        { required: [PRICE, PRICE_CURRENCY], recommended: ["availability", "itemCondition", "shippingDetails", "hasMerchantReturnPolicy"] },
      ],
    },
  },
  {
    feature: "Review snippet",
    types: ["Review"],
    source: `${DOCS}review-snippet`,
    checked: "2026-11-24",
    required: [...(REVIEW.required ?? []), "itemReviewed", "itemReviewed.name"],
    recommended: REVIEW.recommended,
  },
  {
    feature: "Review snippet",
    types: ["AggregateRating"],
    source: `${DOCS}review-snippet`,
    checked: "2026-11-24",
    required: [...(AGGREGATE_RATING.required ?? []), "itemReviewed", "itemReviewed.name"],
  },
  {
    feature: "Breadcrumb",
    types: ["BreadcrumbList"],
    source: `${DOCS}breadcrumb`,
    checked: "2026-11-24",
    // Often nested in a WebPage's breadcrumb property, and a BreadcrumbList is never anything else.
    matchNested: true,
    required: ["itemListElement"],
    properties: {
      itemListElement: { minItems: 2, required: ["position", "name|item.name"], requiredExceptLast: ["item"] },
    },
  },
  {
    feature: "Organization",
    types: ORGANIZATION_TYPES,
    source: `${DOCS}organization`,
    checked: "2026-11-24",
    recommended: ["name", "url", "logo", "sameAs", "description"],
  },
  {
    feature: "Local business",
    types: LOCAL_BUSINESS_TYPES,
    source: `${DOCS}local-business`,
    checked: "2026-11-24",
    required: ["name", "address"],
    recommended: ["url", "telephone", "geo", "openingHoursSpecification", "priceRange"],
    properties: {
      address: { recommended: ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"] },
      geo: { recommended: ["latitude", "longitude"] },
    },
  },
  {
    feature: "Event",
    types: EVENT_TYPES,
    source: `${DOCS}event`,
    checked: "2026-11-24",
    required: ["name", "startDate", "location", "location.address"],
    recommended: ["location.name", "endDate", "eventStatus", "image", "description", "offers", "organizer", "organizer.name", "organizer.url", "performer", "performer.name"],
    properties: {
      offers: { recommended: ["price", "priceCurrency", "availability", "url", "validFrom"] },
    },
  },
  {
    feature: "Recipe",
    types: ["Recipe"],
    source: `${DOCS}recipe`,
    checked: "2026-11-24",
    required: ["name", "image"],
    recommended: [
      "aggregateRating", "author", "cookTime", "datePublished", "description", "keywords", "nutrition.calories", "prepTime",
      "recipeCategory", "recipeCuisine", "recipeIngredient", "recipeInstructions", "recipeYield", "totalTime", "video",
    ],
    properties: { aggregateRating: AGGREGATE_RATING },
  },
  {
    feature: "Video",
    types: ["VideoObject"],
    source: `${DOCS}video`,
    checked: "2026-11-24",
    matchNested: true,
    required: ["name", "thumbnailUrl", "uploadDate"],
    recommended: ["description", "duration", "contentUrl|embedUrl"],
  },
  {
    feature: "Job posting",
    types: ["JobPosting"],
    source: `${DOCS}job-posting`,
    checked: "2026-11-24",
    required: ["title", "description", "datePosted", "hiringOrganization", "hiringOrganization.name", "jobLocation|applicantLocationRequirements", "jobLocation.address.addressCountry"],
    recommended: ["validThrough", "employmentType", "baseSalary", "identifier", "directApply"],
  },
  {
    feature: "Software app",
    types: ["SoftwareApplication", "MobileApplication", "WebApplication"],
    source: `${DOCS}software-app`,
    checked: "2026-11-24",
    required: ["name", "offers", "aggregateRating|review"],
    recommended: ["applicationCategory", "operatingSystem"],
    properties: { ...RATINGS, offers: { required: ["price"], recommended: ["priceCurrency"] } },
  },
  {
    feature: "Movie carousel",
    types: ["Movie"],
    source: `${DOCS}movie`,
    checked: "2026-11-24",
    required: ["name", "image"],
    recommended: ["aggregateRating", "dateCreated", "director", "review"],
    properties: RATINGS,
  },
  {
    feature: "Course list",
    types: ["Course"],
    source: `${DOCS}course`,
    checked: "2026-11-24",
    required: ["name", "description"],
    recommended: ["provider"],
  },
  {
    feature: "Profile page",
    types: ["ProfilePage"],
    source: `${DOCS}profile-page`,
    checked: "2026-11-24",
    required: ["mainEntity"],
    recommended: ["dateCreated", "dateModified"],
    properties: { mainEntity: { required: ["name|alternateName"], recommended: ["image", "sameAs", "description"] } },
  },
  {
    feature: "Discussion forum",
    types: ["DiscussionForumPosting", "SocialMediaPosting"],
    source: `${DOCS}discussion-forum`,
    checked: "2026-11-24",
    // text, image or video may be left out when the posting points at another page by url.
    required: ["author", "author.name", "datePublished", "text|image|video|url"],
    recommended: ["author.url", "url"],
  },
  {
    feature: "Q&A",
    types: ["QAPage"],
    source: `${DOCS}qapage`,
    checked: "2026-11-24",
    required: ["mainEntity"],
    properties: {
      mainEntity: {
        required: ["name", "answerCount", "acceptedAnswer|suggestedAnswer"],
        recommended: ["text", "author", "datePublished"],
        properties: { acceptedAnswer: ANSWER, suggestedAnswer: ANSWER },
      },
    },
  },
  {
    feature: "Employer aggregate rating",
    types: ["EmployerAggregateRating"],
    source: `${DOCS}employer-rating`,
    checked: "2026-11-24",
    required: ["itemReviewed", "ratingValue", "ratingCount|reviewCount"],
  },
  {
    feature: "FAQ",
    types: ["FAQPage"],
    source: "https://developers.google.com/search/updates",
    checked: "2026-11-24",
    deprecated: "Google stopped showing FAQ rich results on 7 May 2026 and removed the documentation on 15 June 2026 (after limiting them to government and health sites in 2023).",
  },
  {
    feature: "How-to",
    types: ["HowTo"],
    source: "https://developers.google.com/search/updates",
    checked: "2026-11-24",
    deprecated: "Google retired How-to rich results on desktop and mobile in September 2023.",
  },
  {
    feature: "Fact check",
    types: ["ClaimReview"],
    source: `${DOCS}factcheck`,
    checked: "2026-11-24",
    deprecated: "Google is phasing out ClaimReview in Search (announced June 2025). Fact Check Explorer still reads it.",
  },
  {
    feature: "Special announcement",
    types: ["SpecialAnnouncement"],
    source: "https://developers.google.com/search/updates",
    checked: "2026-11-24",
    deprecated: "Google stopped showing special announcements on 31 July 2025 and removed the documentation in September 2025.",
  },
  {
    feature: "Dataset",
    types: ["Dataset"],
    source: "https://developers.google.com/search/updates",
    checked: "2026-11-24",
    deprecated: "Google phased Dataset rich results out of Search in November 2025. Dataset Search still reads the markup.",
  },
];

export type ValueFormat =
  | "date"
  | "duration"
  | "url"
  | "price"
  | "currency"
  | "integer"
  | "rating"
  | { name: string; values: readonly string[]; schemaOrg: boolean };

const ITEM_AVAILABILITY = {
  name: "schema.org ItemAvailability value",
  schemaOrg: true,
  values: ["BackOrder", "Discontinued", "InStock", "InStoreOnly", "LimitedAvailability", "MadeToOrder", "OnlineOnly", "OutOfStock", "PreOrder", "PreSale", "Reserved", "SoldOut"],
};

/** Formats checked wherever the property appears, by property name. */
export const VALUE_FORMATS: Readonly<Record<string, ValueFormat>> = {
  datePublished: "date", dateModified: "date", dateCreated: "date", datePosted: "date", uploadDate: "date",
  startDate: "date", endDate: "date", previousStartDate: "date", validFrom: "date", validThrough: "date",
  priceValidUntil: "date", expires: "date", foundingDate: "date",
  duration: "duration", cookTime: "duration", prepTime: "duration", totalTime: "duration",
  url: "url", image: "url", logo: "url", thumbnailUrl: "url", contentUrl: "url", embedUrl: "url", sameAs: "url", item: "url", menu: "url",
  price: "price", lowPrice: "price", highPrice: "price",
  priceCurrency: "currency", currency: "currency",
  ratingValue: "rating",
  ratingCount: "integer", reviewCount: "integer", answerCount: "integer", offerCount: "integer", upvoteCount: "integer",
  commentCount: "integer", userInteractionCount: "integer", position: "integer",
  availability: ITEM_AVAILABILITY,
  itemCondition: { name: "schema.org OfferItemCondition value", schemaOrg: true, values: ["NewCondition", "UsedCondition", "RefurbishedCondition", "DamagedCondition"] },
  eventStatus: { name: "schema.org EventStatusType value", schemaOrg: true, values: ["EventScheduled", "EventCancelled", "EventPostponed", "EventRescheduled", "EventMovedOnline"] },
  employmentType: { name: "Google employmentType value (case-sensitive)", schemaOrg: false, values: ["FULL_TIME", "PART_TIME", "CONTRACTOR", "TEMPORARY", "INTERN", "VOLUNTEER", "PER_DIEM", "OTHER"] },
};
