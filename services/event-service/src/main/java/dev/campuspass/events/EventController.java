package dev.campuspass.events;

import jakarta.validation.Valid;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/events")
public class EventController {

    private static final Set<String> CATEGORIES = Set.of("tech", "cultural", "sports", "workshop", "talk", "other");
    private static final String OBJECT_ID = "^[a-f0-9]{24}$";

    private final EventService service;

    public EventController(EventService service) {
        this.service = service;
    }

    @GetMapping
    public List<Event> list(@RequestParam(required = false) String category) {
        if (category != null && !CATEGORIES.contains(category)) {
            return List.of();
        }
        return service.upcoming(category);
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> get(@PathVariable String id) {
        if (!id.matches(OBJECT_ID)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid event id"));
        }
        return service.find(id)
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Event not found")));
    }

    /** Identity headers are set by the API gateway after it verifies the JWT. */
    @PostMapping
    public ResponseEntity<?> create(
            @Valid @RequestBody EventRequest request,
            @RequestHeader(value = "X-User-Id", required = false) String userId,
            @RequestHeader(value = "X-User-Role", required = false) String role,
            @RequestHeader(value = "X-User-Name", required = false) String encodedName) {
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Login required"));
        }
        if (!"organiser".equals(role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Only organisers can create events"));
        }
        String name = encodedName == null ? "" : URLDecoder.decode(encodedName, StandardCharsets.UTF_8);
        Event saved = service.create(request, userId, name);
        return ResponseEntity.status(HttpStatus.CREATED).body(saved);
    }
}
