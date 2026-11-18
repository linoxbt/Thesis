use anchor_lang::prelude::*;

#[error_code]
pub enum ThesisError {
    #[msg("Program is paused")]
    Paused,
    #[msg("Only the admin or keeper may do this")]
    Unauthorized,
    #[msg("Seed amount is zero or above the per-market cap")]
    InvalidSeed,
    #[msg("Strike must be positive")]
    InvalidStrike,
    #[msg("Window must be longer than the pm-AMM minimum")]
    InvalidWindow,
    #[msg("Account is not the expected pm-AMM PDA")]
    WrongPmAccount,
    #[msg("Market already touched or settled")]
    AlreadyFinal,
    #[msg("Price update is not owned by the Pyth receiver")]
    WrongPriceOwner,
    #[msg("Price update could not be decoded")]
    BadPriceAccount,
    #[msg("Price update is not fully verified")]
    NotFullyVerified,
    #[msg("Price update is for another feed")]
    WrongFeed,
    #[msg("Price publish time is outside the market window")]
    OutsideWindow,
    #[msg("Price exponent differs from the strike exponent")]
    WrongExpo,
    #[msg("Price is not positive")]
    NonPositivePrice,
    #[msg("Confidence interval is too wide")]
    ConfTooWide,
    #[msg("Price did not cross the strike")]
    NoTouch,
    #[msg("Too early to settle")]
    TooEarly,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Spot price is too old")]
    StaleSpot,
    #[msg("Volatility has not been updated recently")]
    StaleVolatility,
    #[msg("TouchBelow needs a strike under spot, TouchAbove one over spot")]
    StrikeWrongSide,
    #[msg("Strike is too close to spot")]
    StrikeTooClose,
    #[msg("Strike is too far from spot")]
    StrikeTooFar,
    #[msg("Opening probability is outside the allowed range")]
    OpeningPriceOutOfRange,
    #[msg("Only the admin or keeper may sponsor a market")]
    SponsorNotAllowed,
    #[msg("Sponsor budget exhausted")]
    SponsorBudgetExhausted,
    #[msg("Creator USDC account required for a creator-seeded market")]
    MissingCreatorUsdc,
    #[msg("Volatility out of range")]
    InvalidVolatility,
    #[msg("Invalid config value")]
    InvalidConfig,
}
