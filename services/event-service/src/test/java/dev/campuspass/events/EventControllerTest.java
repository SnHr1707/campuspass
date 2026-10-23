package dev.campuspass.events;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(EventController.class)
class EventControllerTest {

    private static final String ID = "65f0c0ffee0000000000abcd";

    @Autowired
    MockMvc mvc;

    @MockitoBean
    EventService service;

    private Event sample() {
        Instant start = Instant.now().plus(3, ChronoUnit.DAYS);
        return new Event(ID, "Tech Talk", "desc", "Hall A", "tech", start, 100, "org-1", "Org", Instant.now());
    }

    private String body(String startsAt, int capacity) {
        return """
                {"title":"Tech Talk","description":"x","venue":"Hall A","category":"tech",
                 "startsAt":"%s","capacity":%d}""".formatted(startsAt, capacity);
    }

    @Test
    void listsUpcomingEvents() throws Exception {
        when(service.upcoming(null)).thenReturn(List.of(sample()));
        mvc.perform(get("/events"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].title").value("Tech Talk"))
                .andExpect(jsonPath("$[0].capacity").value(100));
    }

    @Test
    void unknownCategoryReturnsEmptyList() throws Exception {
        mvc.perform(get("/events").param("category", "drop-table"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
        verify(service, never()).upcoming(any());
    }

    @Test
    void getsOneEventOr404() throws Exception {
        when(service.find(ID)).thenReturn(Optional.of(sample()));
        mvc.perform(get("/events/" + ID)).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(ID));

        when(service.find("65f0c0ffee0000000000ffff")).thenReturn(Optional.empty());
        mvc.perform(get("/events/65f0c0ffee0000000000ffff")).andExpect(status().isNotFound());

        mvc.perform(get("/events/not-an-id")).andExpect(status().isBadRequest());
    }

    @Test
    void organiserCanCreateEvent() throws Exception {
        when(service.create(any(), eq("org-1"), eq("Priya Desai"))).thenReturn(sample());
        String future = Instant.now().plus(2, ChronoUnit.DAYS).toString();
        mvc.perform(post("/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-User-Id", "org-1")
                        .header("X-User-Role", "organiser")
                        .header("X-User-Name", "Priya%20Desai")
                        .content(body(future, 100)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(ID));
    }

    @Test
    void studentsCannotCreateEvents() throws Exception {
        String future = Instant.now().plus(2, ChronoUnit.DAYS).toString();
        mvc.perform(post("/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-User-Id", "stu-1")
                        .header("X-User-Role", "student")
                        .content(body(future, 100)))
                .andExpect(status().isForbidden());
        mvc.perform(post("/events").contentType(MediaType.APPLICATION_JSON).content(body(future, 100)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsInvalidEvents() throws Exception {
        String past = Instant.now().minus(1, ChronoUnit.DAYS).toString();
        mvc.perform(post("/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-User-Id", "org-1")
                        .header("X-User-Role", "organiser")
                        .content(body(past, 0)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("capacity")))
                .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("startsAt")));

        mvc.perform(post("/events").contentType(MediaType.APPLICATION_JSON).header("X-User-Id", "o").content("{bad"))
                .andExpect(status().isBadRequest());
    }
}
