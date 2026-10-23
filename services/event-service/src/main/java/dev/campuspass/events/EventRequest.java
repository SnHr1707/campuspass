package dev.campuspass.events;

import jakarta.validation.constraints.Future;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/** What an organiser sends to create an event. Validated before it reaches the database. */
public record EventRequest(
        @NotBlank @Size(max = 120) String title,
        @Size(max = 2000) String description,
        @NotBlank @Size(max = 120) String venue,
        @NotBlank @Pattern(regexp = "tech|cultural|sports|workshop|talk|other") String category,
        @NotNull @Future Instant startsAt,
        @Min(1) @Max(5000) int capacity) {
}
