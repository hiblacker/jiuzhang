package com.bydw.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.bydw.warehouse.ProductAccessService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/**
 * Activation pre-checks run before any database work, so the split codes are
 * verifiable without a database. A mocked {@link JdbcTemplate} returns an empty
 * result by default, which pins the unchanged behaviour once both pre-checks
 * pass: an unknown or consumed invitation still reports EXPIRED.
 */
class BrowserAccountServiceTest {
  private static final String INVITATION = "A".repeat(43);
  private static final String VALID_PASSWORD = "synthetic-pass-12";

  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final BrowserAccountService accounts =
      new BrowserAccountService(jdbc, mock(ProductAccessService.class), new BCryptPasswordEncoder());

  private static String code(Throwable error) { return ((ApiException) error).code(); }

  @Test
  void reportsInvitationFormatForMissingShortAndLongTokens() {
    for (String invitation : new String[] {null, INVITATION.substring(1), INVITATION + "A", "", "   "}) {
      assertThatThrownBy(() -> accounts.activate(invitation, VALID_PASSWORD))
          .isInstanceOf(ApiException.class)
          .extracting(BrowserAccountServiceTest::code)
          .isEqualTo("INVALID_INVITATION_FORMAT");
    }
  }

  @Test
  void reportsInvitationFormatEvenWhenPasswordIsAlsoWrong() {
    // A malformed paste must not be masked by an unrelated short password.
    assertThatThrownBy(() -> accounts.activate(INVITATION.substring(0, 42), "short"))
        .isInstanceOf(ApiException.class)
        .extracting(BrowserAccountServiceTest::code)
        .isEqualTo("INVALID_INVITATION_FORMAT");
  }

  @Test
  void reportsPasswordFormatForShortNullAndOversizedPasswords() {
    for (String password : new String[] {null, "", "short", "eleven-char", "一".repeat(25)}) {
      assertThatThrownBy(() -> accounts.activate(INVITATION, password))
          .isInstanceOf(ApiException.class)
          .extracting(BrowserAccountServiceTest::code)
          .isEqualTo("INVALID_PASSWORD_FORMAT");
    }
  }

  @Test
  void reachesTheInvitationLookupAtExactlyTwelveCharactersAndSeventyTwoBytes() {
    for (String password : new String[] {"twelve-chars", "一".repeat(24)}) {
      assertThatThrownBy(() -> accounts.activate(INVITATION, password))
          .isInstanceOf(ApiException.class)
          .extracting(BrowserAccountServiceTest::code)
          .isEqualTo("INVITATION_EXPIRED");
    }
  }

  @Test
  void keepsBadRequestStatusAndDoesNotEchoSubmittedValues() {
    assertThatThrownBy(() -> accounts.activate(INVITATION, "short"))
        .isInstanceOf(ApiException.class)
        .satisfies(error -> {
          assertThat(((ApiException) error).status()).isEqualTo(HttpStatus.BAD_REQUEST);
          assertThat(error.getMessage()).doesNotContain(INVITATION.substring(0, 8));
        });
  }

  @Test
  void doesNotTouchTheDatabaseWhenTheInvitationOrPasswordIsRejected() {
    assertThatThrownBy(() -> accounts.activate(INVITATION, null)).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> accounts.activate("bad", VALID_PASSWORD)).isInstanceOf(ApiException.class);
    verifyNoInteractions(jdbc);
  }
}
